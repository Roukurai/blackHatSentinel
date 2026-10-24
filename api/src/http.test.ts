import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase } from "./db.ts";
import { createMcpToken, revokeMcpToken } from "./mcp/tokens.ts";
import { createServer } from "./server.ts";
import type { Config, SentinelEvent } from "./types.ts";

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

function batch(): SentinelEvent[] {
  return [1, 2, 3, 4, 5].map((port) => ({
    event_id: createHash("sha256").update(`http-${port}`).digest("hex"),
    host_id: "ubuntu-01",
    timestamp: `2026-10-24T22:00:0${port}.000Z`,
    type: "ssh_invalid_user" as const,
    username: port === 1 ? "" : "root",
    source_ip: "203.0.113.10",
    source_port: 41000 + port,
    raw_message: "RAW_SHOULD_NOT_LEAK",
    origin: "replay" as const,
  }));
}

test("localhost ingest creates an incident and serves it", async () => {
  const db = openDatabase(":memory:");
  const sent: string[] = [];
  const server = createServer({
    config: config(),
    db,
    send: async (text) => {
      sent.push(text);
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const posted = await fetch(`${base}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(batch()),
  });
  assert.equal(posted.status, 200);
  assert.deepEqual(await posted.json(), { accepted: 5, duplicates: 0 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].includes("RAW_SHOULD_NOT_LEAK"), false);
  assert.equal(sent[0].includes("root"), false);

  const listed = await fetch(`${base}/incidents`);
  assert.equal(listed.status, 200);
  const incidents = await listed.json() as Array<{ id: string; severity: string }>;
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].severity, "medium");

  const detail = await fetch(`${base}/incidents/${incidents[0].id}`);
  const body = await detail.json() as { events: Array<{ username: string }>; notification: { status: string } };
  assert.equal(body.notification.status, "sent");
  assert.ok(body.events.some((event) => event.username === ""));

  // Investigation is fire-and-forget after Telegram; wait briefly for persist (no LLM key → unavailable).
  let investigation: { status?: string } | null = null;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 20));
    const again = await fetch(`${base}/incidents/${incidents[0].id}`);
    const payload = await again.json() as { investigation: { status?: string } | null; status: string };
    if (payload.investigation) {
      investigation = payload.investigation;
      assert.equal(payload.investigation.status, "unavailable");
      assert.equal(payload.status, "new");
      break;
    }
  }
  assert.ok(investigation, "expected investigation to be persisted");

  const rerun = await fetch(`${base}/incidents/${incidents[0].id}/investigate`, { method: "POST" });
  assert.equal(rerun.status, 200);
  const rerunBody = await rerun.json() as { status: string };
  assert.equal(rerunBody.status, "unavailable");

  const health = await fetch(`${base}/health`);
  assert.deepEqual(await health.json(), {
    collector_last_event_at: "2026-10-24T22:00:05.000Z",
    llm: "down",
    telegram: "ok",
    db: "ok",
    host_id: null,
  });

  const rejected = await fetch(`${base}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(rejected.status, 400);
  const counter = db.prepare("SELECT value FROM counters WHERE name = ?").get("rejected_batches") as { value: number };
  assert.equal(Number(counter.value), 1);

  server.close();
  await once(server, "close");
  db.close();
});

test("PUT /settings/llm stores key without echoing it", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sentinel-http-llm-"));
  const settingsPath = path.join(dir, "llm-settings.json");
  const db = openDatabase(":memory:");
  const server = createServer({
    config: config({ llmSettingsPath: settingsPath }),
    db,
    send: async () => {},
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const put = await fetch(`${base}/settings/llm`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      apiKey: "sk-live-secret-key-9999",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    }),
  });
  assert.equal(put.status, 200);
  const body = await put.json() as { configured: boolean; keyLast4: string; model: string };
  assert.equal(body.configured, true);
  assert.equal(body.keyLast4, "9999");
  assert.equal(body.model, "gpt-4o-mini");
  assert.ok(!JSON.stringify(body).includes("sk-live-secret-key-9999"));

  const get = await fetch(`${base}/settings/llm`);
  assert.equal(get.status, 200);
  const got = await get.json() as { keyLast4: string };
  assert.equal(got.keyLast4, "9999");

  server.close();
  await once(server, "close");
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("dashboard routes require basic auth when credentials are set", async () => {
  const db = openDatabase(":memory:");
  const server = createServer({
    config: config({ dashboardUser: "analyst", dashboardPass: "secret" }),
    db,
    send: async () => {},
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/health`;

  const denied = await fetch(url);
  assert.equal(denied.status, 401);
  const allowed = await fetch(url, {
    headers: { authorization: `Basic ${Buffer.from("analyst:secret").toString("base64")}` },
  });
  assert.equal(allowed.status, 200);

  server.close();
  await once(server, "close");
  db.close();
});

test("POST /mcp requires Bearer token; tools/list works with valid token", async () => {
  const db = openDatabase(":memory:");
  const server = createServer({
    config: config({ dashboardUser: "analyst", dashboardPass: "secret" }),
    db,
    send: async () => {},
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const rpcList = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  };

  // No tokens yet → remote disabled
  const disabled = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(rpcList),
  });
  assert.equal(disabled.status, 503);

  const { token, meta } = createMcpToken(db, "grok");

  const missing = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(rpcList),
  });
  assert.equal(missing.status, 401);

  const bad = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer sntl_mcp_not-a-real-token-xxxxxxxxxxxx",
    },
    body: JSON.stringify(rpcList),
  });
  assert.equal(bad.status, 401);

  // Basic auth must not unlock /mcp
  const basic = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from("analyst:secret").toString("base64")}`,
    },
    body: JSON.stringify(rpcList),
  });
  assert.equal(basic.status, 401);

  const ok = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(rpcList),
  });
  assert.equal(ok.status, 200);
  const listed = await ok.json() as {
    result?: { tools?: Array<{ name: string }> };
  };
  assert.ok(listed.result?.tools?.some((t) => t.name === "health"));

  const other = createMcpToken(db, "cursor");
  assert.ok(revokeMcpToken(db, meta.id));
  // Revoked token → 401 while another token keeps remote enabled
  const revoked = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(rpcList),
  });
  assert.equal(revoked.status, 401);

  assert.ok(revokeMcpToken(db, other.meta.id));
  // No active tokens → remote disabled (503)
  const disabledAgain = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${other.token}`,
    },
    body: JSON.stringify(rpcList),
  });
  assert.equal(disabledAgain.status, 503);

  server.close();
  await once(server, "close");
  db.close();
});
