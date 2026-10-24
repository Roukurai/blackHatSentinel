import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { openDatabase } from "./db.ts";
import { getAuthHistory, getIncidentEvents } from "./evidence.ts";
import { ingest } from "./ingest.ts";
import type { Config, SentinelEvent } from "./types.ts";

const config: Config = {
  bind: "127.0.0.1",
  port: 0,
  publicBaseUrl: "http://127.0.0.1:8080",
  dbPath: ":memory:",
  llmSettingsPath: "/tmp/sentinel-test-llm-settings.json",
  dashboardUser: "",
  dashboardPass: "",
  telegramToken: "",
  telegramChatId: "",
  notifyCooldownSeconds: 300,
  detect: { fastCount: 5, fastWindowMs: 120_000, slowCount: 10, slowWindowMs: 1_800_000 },
  llmBaseUrl: "",
};

function event(seed: string, timestamp: string, port: number): SentinelEvent {
  return {
    event_id: createHash("sha256").update(seed).digest("hex"),
    host_id: "ubuntu-01",
    timestamp,
    type: "ssh_invalid_user",
    username: "root",
    source_ip: "203.0.113.10",
    source_port: port,
    raw_message: "RAW_SHOULD_NOT_LEAK",
    origin: "replay",
  };
}

test("incident events and auth history stay tied to stored evidence", () => {
  const db = openDatabase(":memory:");
  const events = [1, 2, 3, 4, 5].map((port) => event(
    `evidence-${port}`,
    `2026-10-24T22:00:0${port}.000Z`,
    43000 + port,
  ));
  events.push(event("evidence-old", "2026-10-24T20:00:00.000Z", 43999));
  ingest(db, events, config);

  const linked = getIncidentEvents(db, "inc-001");
  assert.ok(linked);
  assert.equal(linked.length, 6);
  assert.equal(linked.every((item) => item.raw_message === "RAW_SHOULD_NOT_LEAK"), true);
  assert.equal(getIncidentEvents(db, "inc-999"), null);

  const recent = getAuthHistory(db, { sourceIp: "203.0.113.10", windowSeconds: 120 });
  assert.deepEqual(recent.map((item) => item.source_port), [43001, 43002, 43003, 43004, 43005]);
  const byUser = getAuthHistory(db, { username: "root", windowSeconds: 3 * 60 * 60 });
  assert.equal(byUser.length, 6);
  db.close();
});
