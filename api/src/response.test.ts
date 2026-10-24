import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { policyViolation } from "./actions.ts";
import { openDatabase } from "./db.ts";
import { createServer } from "./server.ts";
import type { SendText } from "./notify.ts";
import type { Config, ResponseConfig, SentinelEvent } from "./types.ts";

const response: ResponseConfig = { allowlist: ["198.51.100.0/24"], ttlSeconds: 600, runner: "", runnerSudo: false };

function config(overrides: Partial<Config> = {}): Config {
  return {
    bind: "127.0.0.1",
    port: 0,
    publicBaseUrl: "http://127.0.0.1:8080",
    dbPath: ":memory:",
    dashboardUser: "",
    dashboardPass: "",
    telegramToken: "test-token",
    telegramChatId: "1",
    notifyCooldownSeconds: 300,
    detect: { fastCount: 5, fastWindowMs: 120_000, slowCount: 10, slowWindowMs: 1_800_000 },
    llmBaseUrl: "",
    hostId: "ubuntu-01",
    response,
    ...overrides,
  };
}

function burst(ip: string, origin: SentinelEvent["origin"] = "live"): SentinelEvent[] {
  return [1, 2, 3, 4, 5].map((port) => ({
    event_id: createHash("sha256").update(`${ip}-${port}`).digest("hex"),
    host_id: "ubuntu-01",
    timestamp: `2026-10-24T22:00:0${port}.000Z`,
    type: "ssh_invalid_user" as const,
    username: "root",
    source_ip: ip,
    source_port: 41000 + port,
    raw_message: "Invalid user root",
    origin,
  }));
}

async function start(cfg: Config, send: SendText = async () => {}) {
  const server = createServer({ config: cfg, db: openDatabase(":memory:"), send });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (p: string, body?: unknown) =>
    fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const get = (p: string, accept = "application/json") => fetch(`${base}${p}`, { headers: { accept } });
  return { server, post, get };
}

test("policy protects allowlisted, loopback and invalid targets", () => {
  assert.match(policyViolation("198.51.100.7", response) ?? "", /protected/);
  assert.match(policyViolation("127.0.0.1", response) ?? "", /protected/);
  assert.match(policyViolation("not-an-ip", response) ?? "", /valid IP/);
  assert.equal(policyViolation("203.0.113.9", response), null);
});

test("a burst proposes a block; approve without a runner fails honestly; origin is exposed", async () => {
  const { server, post, get } = await start(config());
  try {
    assert.equal((await post("/events", burst("203.0.113.9", "replay"))).status, 200);
    const [incident] = (await (await get("/incidents")).json()) as Array<{ id: string; origin: string; action: { id: string; status: string } }>;
    assert.equal(incident.origin, "replay");
    assert.equal(incident.action.status, "proposed");

    const approved = await post(`/actions/${incident.action.id}/approve`);
    assert.equal(approved.status, 200);
    const action = (await approved.json()) as { status: string; policy_reason: string };
    assert.equal(action.status, "failed");
    assert.match(action.policy_reason, /runner not configured/);

    const detail = (await (await get(`/incidents/${incident.id}`)).json()) as { status: string };
    assert.equal(detail.status, "action_failed");
    assert.equal((await post(`/actions/${incident.action.id}/approve`)).status, 409);
  } finally {
    server.close();
  }
});

test("allowlisted sources are rejected by policy and approval cannot override it", async () => {
  const { server, post, get } = await start(config());
  try {
    await post("/events", burst("198.51.100.7"));
    const [incident] = (await (await get("/incidents")).json()) as Array<{ action: { id: string; status: string; policy_reason: string } }>;
    assert.equal(incident.action.status, "rejected_by_policy");
    assert.match(incident.action.policy_reason, /protected/);
    assert.equal((await post(`/actions/${incident.action.id}/approve`)).status, 409);
  } finally {
    server.close();
  }
});

test("reject marks the incident and blocks later approval", async () => {
  const { server, post, get } = await start(config());
  try {
    await post("/events", burst("203.0.113.20"));
    const [incident] = (await (await get("/incidents")).json()) as Array<{ id: string; action: { id: string } }>;
    assert.equal((await post(`/actions/${incident.action.id}/reject`)).status, 200);
    const detail = (await (await get(`/incidents/${incident.id}`)).json()) as { status: string };
    assert.equal(detail.status, "action_rejected");
    assert.equal((await post(`/actions/${incident.action.id}/approve`)).status, 409);
  } finally {
    server.close();
  }
});

test("a Telegram outage does not stop the investigation", async () => {
  const { server, post, get } = await start(config(), async () => {
    throw new Error("telegram down");
  });
  try {
    await post("/events", burst("203.0.113.30"));
    const [incident] = (await (await get("/incidents")).json()) as Array<{ id: string }>;
    let investigation: { status: string } | null = null;
    for (let i = 0; i < 50 && !investigation; i++) {
      await new Promise((r) => setTimeout(r, 20));
      investigation = ((await (await get(`/incidents/${incident.id}`)).json()) as { investigation: { status: string } | null }).investigation;
    }
    assert.ok(investigation, "investigation should run even though Telegram failed");
  } finally {
    server.close();
  }
});

test("serves the dashboard for browser navigations and JSON for API calls", async () => {
  const dist = mkdtempSync(path.join(tmpdir(), "sentinel-web-"));
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(path.join(dist, "index.html"), "<!doctype html><div id=root></div>");
  writeFileSync(path.join(dist, "assets", "app.js"), "console.log(1)");
  const { server, post, get } = await start(config({ webDist: dist }));
  try {
    await post("/events", burst("203.0.113.40"));
    const page = await get("/incidents/inc-001", "text/html,application/xhtml+xml");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await page.text(), /id=root/);

    const json = await get("/incidents/inc-001");
    assert.match(json.headers.get("content-type") ?? "", /application\/json/);

    const asset = await get("/assets/app.js", "*/*");
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("cache-control") ?? "", /immutable/);

    const traversal = await get("/assets/..%2f..%2fpackage.json", "*/*");
    assert.equal(traversal.status, 404);
  } finally {
    server.close();
  }
});
