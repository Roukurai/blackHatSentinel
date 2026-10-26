import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase } from "./db.ts";
import { flushNotifications, purgeUntrustedTelegramRecipients } from "./notify.ts";
import type { Config } from "./types.ts";
import { createLinkCode, ensureUserTables, insertUser } from "./users.ts";

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
    telegramChatId: "111",
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

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function privateMessage(updateId: number, chatId: number, text: string) {
  return { update_id: updateId, message: { text, chat: { id: chatId, type: "private" as const } } };
}

test("unknown private chats are not stored and get no reply", async () => {
  const db = openDatabase(":memory:");
  const cfg = config();
  const sent: Array<{ chat_id: string; text: string }> = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes("getUpdates")) {
      return jsonOk({ ok: true, result: [privateMessage(1, 999, "hello stranger")] });
    }
    if (url.includes("sendMessage")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { chat_id: string; text: string };
      sent.push(body);
      return jsonOk({ ok: true });
    }
    throw new Error(url);
  }) as typeof fetch;
  try {
    await flushNotifications(db, cfg);
  } finally {
    globalThis.fetch = orig;
  }
  const rows = db.prepare("SELECT chat_id FROM telegram_recipients").all() as Array<{ chat_id: string }>;
  assert.deepEqual(rows.map((row) => row.chat_id), []);
  assert.deepEqual(sent, []);
  db.close();
});

test("a valid dashboard link code registers that chat only", async () => {
  const db = openDatabase(":memory:");
  ensureUserTables(db);
  const user = insertUser(db, "analyst", "hash");
  const { code } = createLinkCode(db, user.id);
  const cfg = config();
  const sent: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes("getUpdates")) {
      return jsonOk({
        ok: true,
        result: [privateMessage(7, 555, code), privateMessage(8, 999, "noise")],
      });
    }
    if (url.includes("sendMessage")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { chat_id: string };
      sent.push(String(body.chat_id));
      return jsonOk({ ok: true });
    }
    throw new Error(url);
  }) as typeof fetch;
  try {
    await flushNotifications(db, cfg);
  } finally {
    globalThis.fetch = orig;
  }
  const rows = db.prepare("SELECT chat_id FROM telegram_recipients ORDER BY chat_id").all() as Array<{ chat_id: string }>;
  assert.deepEqual(rows.map((row) => row.chat_id), ["555"]);
  assert.ok(sent.includes("555"));
  assert.equal(sent.includes("999"), false);
  const bound = db.prepare("SELECT telegram_chat_id FROM dashboard_users WHERE id = ?").get(user.id) as { telegram_chat_id: string };
  assert.equal(bound.telegram_chat_id, "555");
  db.close();
});

test("configured TELEGRAM_CHAT_ID may be stored; strangers are still ignored", async () => {
  const db = openDatabase(":memory:");
  const cfg = config({ telegramChatId: "111" });
  const sent: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes("getUpdates")) {
      return jsonOk({
        ok: true,
        result: [privateMessage(1, 111, "hi"), privateMessage(2, 222, "also hi")],
      });
    }
    if (url.includes("sendMessage")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { chat_id: string };
      sent.push(String(body.chat_id));
      return jsonOk({ ok: true });
    }
    throw new Error(url);
  }) as typeof fetch;
  try {
    await flushNotifications(db, cfg);
  } finally {
    globalThis.fetch = orig;
  }
  const rows = db.prepare("SELECT chat_id FROM telegram_recipients").all() as Array<{ chat_id: string }>;
  assert.deepEqual(rows.map((row) => row.chat_id), ["111"]);
  assert.deepEqual(sent, []);
  db.close();
});

test("startup purge removes recipients that are neither configured nor bound", () => {
  const db = openDatabase(":memory:");
  ensureUserTables(db);
  const cfg = config({ telegramChatId: "111" });
  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_recipients (
      chat_id TEXT PRIMARY KEY,
      added_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO telegram_recipients (chat_id, added_at) VALUES (?, ?)").run("111", "2026-01-01T00:00:00.000Z");
  db.prepare("INSERT INTO telegram_recipients (chat_id, added_at) VALUES (?, ?)").run("999", "2026-01-01T00:00:00.000Z");
  db.prepare("INSERT INTO telegram_recipients (chat_id, added_at) VALUES (?, ?)").run("555", "2026-01-01T00:00:00.000Z");
  const user = insertUser(db, "analyst", "hash");
  db.prepare("UPDATE dashboard_users SET telegram_chat_id = ? WHERE id = ?").run("555", user.id);
  const removed = purgeUntrustedTelegramRecipients(db, cfg);
  assert.equal(removed, 1);
  const rows = db.prepare("SELECT chat_id FROM telegram_recipients ORDER BY chat_id").all() as Array<{ chat_id: string }>;
  assert.deepEqual(rows.map((row) => row.chat_id), ["111", "555"]);
  db.close();
});
