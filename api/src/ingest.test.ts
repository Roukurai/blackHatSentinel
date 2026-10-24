import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { openDatabase, listIncidentRecords, toIncident } from "./db.ts";
import { ingest } from "./ingest.ts";
import { flushNotifications } from "./notify.ts";
import type { Config, EventType, SentinelEvent } from "./types.ts";
import { ValidationError } from "./validate.ts";

function config(overrides: Partial<Config> = {}): Config {
  return {
    bind: "127.0.0.1",
    port: 0,
    publicBaseUrl: "http://127.0.0.1:8080",
    dbPath: ":memory:",
    llmSettingsPath: "/tmp/sentinel-test-llm-settings.json",
    dashboardUser: "",
    dashboardPass: "",
    telegramToken: "test-token",
    telegramChatId: "1",
    notifyCooldownSeconds: 300,
    detect: {
      fastCount: 5,
      fastWindowMs: 120_000,
      slowCount: 10,
      slowWindowMs: 1_800_000,
    },
    llmBaseUrl: "",
    ...overrides,
  };
}

function event(seed: string, fields: Partial<SentinelEvent> & Pick<SentinelEvent, "timestamp" | "type" | "source_ip">): SentinelEvent {
  return {
    event_id: createHash("sha256").update(seed).digest("hex"),
    host_id: "ubuntu-01",
    username: "root",
    source_port: 22,
    raw_message: `RAW_SHOULD_NOT_LEAK ${seed}`,
    origin: "replay",
    ...fields,
  };
}

function at(base: number, seconds: number): string {
  return new Date(base + seconds * 1000).toISOString();
}

function checkpointEvents(): SentinelEvent[] {
  const base = Date.parse("2026-10-24T15:51:15.000Z");
  const events: SentinelEvent[] = [];
  let cursor = 0;
  const push = (seconds: number, type: EventType, ip: string, port: number, username: string) => {
    cursor += 1;
    events.push(event(`cursor-${cursor}`, {
      timestamp: at(base, seconds),
      type,
      source_ip: ip,
      source_port: port,
      username,
    }));
  };
  for (let i = 0; i < 8; i += 1) push(i, "ssh_invalid_user", "192.0.2.50", 21000 + i, "user");
  for (let i = 0; i < 6; i += 1) push(8 + i, "ssh_invalid_user", "192.0.2.50", 22000 + i, "admin");
  push(14, "ssh_invalid_user", "192.0.2.50", 23000, "");
  push(16, "ssh_preauth_disconnect", "198.51.100.7", 40001, "root");
  const slowStart = 5 * 60;
  for (const [index, username] of ["sol", "solana", "eth", "ethereum", "validator", "polygon", "tron", "node", "bot", "trader"].entries()) {
    push(slowStart + index * 120, "ssh_invalid_user", "203.0.113.9", 30000, username);
  }
  const demo = 40 * 60;
  for (let i = 0; i < 6; i += 1) push(demo + i * 4, "ssh_failed_password", "203.0.113.77", 50000 + i, "demo");
  push(demo + 24, "ssh_success", "203.0.113.77", 50010, "demo");
  push(demo + 26, "ssh_success", "203.0.113.200", 59999, "rou");
  return events;
}

test("checkpoint replay opens one incident per source and alerts once", async () => {
  const db = openDatabase(":memory:");
  const sent: string[] = [];
  const cfg = config();
  const events = checkpointEvents();
  const first = ingest(db, events, cfg);
  assert.equal(first.accepted, events.length);
  assert.equal(first.duplicates, 0);
  await flushNotifications(db, cfg, async (text) => {
    sent.push(text);
  });

  const again = ingest(db, events, cfg);
  assert.equal(again.accepted, 0);
  assert.equal(again.duplicates, events.length);
  await flushNotifications(db, cfg, async (text) => {
    sent.push(text);
  });

  const incidents = listIncidentRecords(db).map(toIncident).reverse();
  assert.deepEqual(incidents.map((incident) => incident.source_ip), [
    "192.0.2.50",
    "203.0.113.77",
    "203.0.113.200",
  ]);

  const burst = incidents[0];
  assert.equal(burst.severity, "medium");
  assert.ok(burst.patterns.includes("burst"));
  assert.equal(burst.failed_attempts, 15);
  assert.ok(burst.usernames.includes(""));
  assert.equal(burst.notification.status, "sent");

  const demo = incidents[1];
  assert.equal(demo.severity, "high");
  assert.ok(demo.patterns.includes("success_after_failures"));
  assert.equal(demo.notification.attempts, 1);

  const benign = incidents[2];
  assert.equal(benign.severity, "low");
  assert.deepEqual(benign.patterns, ["new_source_success"]);

  assert.equal(sent.length, 3);
  for (const text of sent) {
    assert.equal(text.includes("RAW_SHOULD_NOT_LEAK"), false);
    assert.equal(text.includes("solana"), false);
    assert.equal(text.includes("admin"), false);
    assert.equal(text.includes("compromised"), false);
    assert.match(text, /^Sentinel \/ suspicious SSH activity\nHost: ubuntu-01\nSource: /);
    assert.match(text, /Failed attempts: \d+/);
    assert.match(text, /Events: \d+/);
    assert.match(text, /Accounts tried: \d+/);
    assert.match(text, /Origin: replay/);
    assert.match(text, /Status: investigation pending/);
  }
  assert.match(sent[1], /Severity: high/);
  assert.match(sent[1], /success after failures/);
  assert.match(sent[2], /Severity: low/);
  assert.match(sent[2], /success from a new source/);
  db.close();
});

test("a bad event rejects the whole batch", () => {
  const db = openDatabase(":memory:");
  const good = event("good", {
    timestamp: "2026-10-24T18:00:00.000Z",
    type: "ssh_invalid_user",
    source_ip: "203.0.113.10",
  });
  const bad = { ...good, event_id: "nope", type: "ssh_flood" };
  assert.throws(() => ingest(db, [good, bad], config()), ValidationError);
  const row = db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
  assert.equal(Number(row.n), 0);
  db.close();
});

test("empty username is stored", () => {
  const db = openDatabase(":memory:");
  const events = [1, 2, 3, 4, 5].map((port) => event(`empty-${port}`, {
    timestamp: `2026-10-24T18:00:0${port}.000Z`,
    type: "ssh_invalid_user",
    source_ip: "203.0.113.40",
    source_port: port,
    username: "",
  }));
  assert.doesNotThrow(() => ingest(db, events, config()));
  const incident = listIncidentRecords(db)[0];
  assert.deepEqual(incident.usernames, [""]);
  db.close();
});

test("related events update the incident and escalation waits for the cooldown", async () => {
  const db = openDatabase(":memory:");
  const cfg = config();
  const sent: string[] = [];
  const send = async (text: string) => {
    sent.push(text);
  };
  const failures = [1, 2, 3, 4, 5].map((port) => event(`fail-${port}`, {
    timestamp: `2026-10-24T19:00:0${port}.000Z`,
    type: "ssh_failed_password",
    source_ip: "203.0.113.77",
    source_port: 50000 + port,
    username: "demo",
  }));
  ingest(db, failures, cfg);
  await flushNotifications(db, cfg, send);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Severity: medium/);

  ingest(db, [event("success", {
    timestamp: "2026-10-24T19:00:20.000Z",
    type: "ssh_success",
    source_ip: "203.0.113.77",
    source_port: 50010,
    username: "demo",
  })], cfg);
  await flushNotifications(db, cfg, send);
  assert.equal(sent.length, 1);
  const waiting = listIncidentRecords(db)[0];
  assert.equal(waiting.severity, "high");
  assert.equal(waiting.pendingKind, "escalation");

  db.prepare("UPDATE incidents SET next_send_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", waiting.id);
  await flushNotifications(db, cfg, send);
  assert.equal(sent.length, 2);
  assert.match(sent[1], /^Sentinel \/ incident escalated/);
  assert.match(sent[1], /Severity: high/);
  assert.equal(sent[1].includes("demo"), false);

  ingest(db, [event("later", {
    timestamp: "2026-10-24T19:00:30.000Z",
    type: "ssh_invalid_user",
    source_ip: "203.0.113.77",
    source_port: 50020,
    username: "demo",
  })], cfg);
  await flushNotifications(db, cfg, send);
  assert.equal(sent.length, 2);
  assert.equal(listIncidentRecords(db)[0].escalationSent, true);
  db.close();
});

test("a telegram outage keeps the incident and retries", async () => {
  const db = openDatabase(":memory:");
  const cfg = config();
  const events = [1, 2, 3, 4, 5].map((port) => event(`down-${port}`, {
    timestamp: `2026-10-24T20:00:0${port}.000Z`,
    type: "ssh_invalid_user",
    source_ip: "203.0.113.80",
    source_port: port,
  }));
  const result = ingest(db, events, cfg);
  assert.equal(result.accepted, 5);
  await flushNotifications(db, cfg, async () => {
    throw new Error("network down");
  });
  const failed = listIncidentRecords(db)[0];
  assert.equal(failed.notificationStatus, "failed");
  assert.equal(failed.notificationAttempts, 1);
  assert.equal(failed.pendingKind, "new");

  db.prepare("UPDATE incidents SET next_send_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", failed.id);
  await flushNotifications(db, cfg, async () => {});
  const sent = listIncidentRecords(db)[0];
  assert.equal(sent.notificationStatus, "sent");
  assert.equal(sent.pendingKind, null);
  db.close();
});

test("overlapping flushes send one alert", async () => {
  const db = openDatabase(":memory:");
  const cfg = config();
  ingest(db, [1, 2, 3, 4, 5].map((port) => event(`race-${port}`, {
    timestamp: `2026-10-24T21:00:0${port}.000Z`,
    type: "ssh_invalid_user",
    source_ip: "203.0.113.90",
    source_port: port,
  })), cfg);

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = 0;
  const send = async () => {
    started += 1;
    await gate;
  };
  const first = flushNotifications(db, cfg, send);
  await new Promise((resolve) => setImmediate(resolve));
  const second = flushNotifications(db, cfg, send);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(started, 1);
  db.close();
});

test("ten distinct ports inside the slow window are low-and-slow", () => {
  const db = openDatabase(":memory:");
  const base = Date.parse("2026-10-24T16:00:00.000Z");
  const events = Array.from({ length: 10 }, (_, index) => event(`slow-${index}`, {
    timestamp: new Date(base + index * 120_000).toISOString(),
    type: "ssh_invalid_user",
    source_ip: "203.0.113.9",
    source_port: 30000 + index,
    username: `user-${index}`,
  }));
  ingest(db, events, config());
  const incident = listIncidentRecords(db)[0];
  assert.equal(incident.severity, "low");
  assert.deepEqual(incident.patterns, ["low_and_slow"]);
  assert.equal(incident.failedAttempts, 10);
  db.close();
});

test("local events outside the slow window open a separate incident", () => {
  const db = openDatabase(":memory:");
  const cfg = config();
  const batch = (seed: string, start: string) => [0, 1, 2, 3, 4].map((index) => event(`${seed}-${index}`, {
    timestamp: new Date(Date.parse(start) + index * 1000).toISOString(),
    type: "ssh_invalid_user",
    source_ip: null,
    source_port: null,
    username: "root",
  }));
  ingest(db, batch("early", "2026-10-24T10:00:00.000Z"), cfg);
  ingest(db, batch("later", "2026-10-24T12:00:00.000Z"), cfg);
  assert.equal(listIncidentRecords(db).length, 2);
  db.close();
});
