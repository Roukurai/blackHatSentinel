import type { DatabaseSync } from "node:sqlite";
import { alertText } from "./alert.ts";
import {
  claimNotification,
  eventsByIds,
  incidentById,
  listDueIncidents,
  saveIncident,
  toIncident,
  type IncidentRecord,
} from "./db.ts";
import type { Config } from "./types.ts";
import { markPersonalDelivered, pendingPersonal, tryBindTelegram } from "./users.ts";

export type SendText = (text: string) => Promise<void>;

function configuredChatIds(config: Config): string[] {
  return [...new Set(config.telegramChatId.split(/[\s,]+/).map((id) => id.trim()).filter(Boolean))];
}

function ensureTelegramTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_recipients (
      chat_id TEXT PRIMARY KEY,
      added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telegram_offset (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      update_offset INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      incident_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      PRIMARY KEY (incident_id, kind, chat_id)
    );
  `);
}

function deliveredChats(db: DatabaseSync, incidentId: string, kind: string): Set<string> {
  const rows = db.prepare(
    "SELECT chat_id FROM notification_deliveries WHERE incident_id = ? AND kind = ?",
  ).all(incidentId, kind) as Array<{ chat_id: string }>;
  return new Set(rows.map((row) => row.chat_id));
}

function markDelivered(db: DatabaseSync, incidentId: string, kind: string, chatId: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO notification_deliveries (incident_id, kind, chat_id) VALUES (?, ?, ?)",
  ).run(incidentId, kind, chatId);
}

function rememberChat(db: DatabaseSync, chatId: string): boolean {
  const existing = db.prepare("SELECT 1 AS ok FROM telegram_recipients WHERE chat_id = ?").get(chatId);
  db.prepare("INSERT OR IGNORE INTO telegram_recipients (chat_id, added_at) VALUES (?, ?)").run(
    chatId,
    new Date().toISOString(),
  );
  return !existing;
}

function alertChatIds(db: DatabaseSync, config: Config): string[] {
  const saved = db.prepare("SELECT chat_id FROM telegram_recipients").all() as Array<{ chat_id: string }>;
  return [...new Set([...configuredChatIds(config), ...saved.map((row) => row.chat_id)])];
}

function privateChat(update: {
  message?: { text?: string; chat?: { id?: number; type?: string } };
  edited_message?: { text?: string; chat?: { id?: number; type?: string } };
  my_chat_member?: { chat?: { id?: number; type?: string } };
}): { id: string; text: string } | null {
  const message = update.message ?? update.edited_message;
  const chat = message?.chat ?? update.my_chat_member?.chat;
  if (!chat || chat.type !== "private" || chat.id === undefined) return null;
  return { id: String(chat.id), text: message?.text ?? "" };
}

async function syncLinkedChats(db: DatabaseSync, token: string): Promise<void> {
  const row = db.prepare("SELECT update_offset FROM telegram_offset WHERE id = 1").get() as { update_offset: number } | undefined;
  const offset = row?.update_offset ?? 0;
  const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
  url.searchParams.set("timeout", "0");
  url.searchParams.set("allowed_updates", JSON.stringify(["message", "edited_message", "my_chat_member"]));
  if (offset > 0) url.searchParams.set("offset", String(offset));
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const payload = await response.json() as {
    ok?: boolean;
    result?: Array<{
      update_id: number;
      message?: { text?: string; chat?: { id?: number; type?: string } };
      edited_message?: { text?: string; chat?: { id?: number; type?: string } };
      my_chat_member?: { chat?: { id?: number; type?: string } };
    }>;
  };
  if (!payload.ok || !payload.result) return;
  let next = offset;
  for (const update of payload.result) {
    next = Math.max(next, update.update_id + 1);
    const chat = privateChat(update);
    if (!chat) continue;
    const isNew = rememberChat(db, chat.id);
    tryBindTelegram(db, chat.text, chat.id);
    if (!isNew) continue;
    try {
      await deliverTelegram(
        { telegramToken: token, telegramChatId: chat.id } as Config,
        chat.id,
        "Sentinel\nThis device is registered. Alerts for this host will arrive here.",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "telegram failed";
      console.error(`telegram register failed for ${chat.id}: ${message}`);
    }
  }
  if (next === offset) return;
  db.prepare(`
    INSERT INTO telegram_offset (id, update_offset) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET update_offset = excluded.update_offset
  `).run(next);
}

async function deliverPersonal(db: DatabaseSync, config: Config): Promise<void> {
  for (const item of pendingPersonal(db)) {
    try {
      await deliverTelegram(config, item.chatId, item.body);
      markPersonalDelivered(db, item.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "telegram failed";
      console.error(`personal telegram failed for ${item.id}: ${message}`);
    }
  }
}

async function deliverTelegram(config: Config, chatId: string, text: string): Promise<void> {
  if (!config.telegramToken || !chatId) {
    throw new Error("telegram is not configured");
  }
  const response = await fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  let description = `telegram HTTP ${response.status}`;
  try {
    const payload = await response.json() as { ok?: boolean; description?: string };
    if (payload.ok) return;
    if (payload.description) description = payload.description;
  } catch {
    // keep the HTTP status
  }
  throw new Error(description);
}

function markSent(record: IncidentRecord): void {
  const now = new Date().toISOString();
  record.notificationStatus = "sent";
  record.notificationAttempts += 1;
  record.notificationLastAttemptAt = now;
  record.notificationLastSentAt = now;
  if (record.pendingKind === "escalation") record.escalationSent = true;
  record.pendingKind = null;
  record.nextSendAt = null;
  record.notifyClaimed = false;
}

function markFailed(record: IncidentRecord): void {
  record.notificationStatus = "failed";
  record.notificationAttempts += 1;
  record.notificationLastAttemptAt = new Date().toISOString();
  const backoffMs = Math.min(60_000, 5_000 * 2 ** Math.min(record.notificationAttempts, 4));
  record.nextSendAt = new Date(Date.now() + backoffMs).toISOString();
  record.notifyClaimed = false;
}

/** Returns incident ids that were successfully notified in this flush (new or escalation). */
export async function flushNotifications(
  db: DatabaseSync,
  config: Config,
  send?: SendText,
): Promise<string[]> {
  ensureTelegramTables(db);
  if (send === undefined && config.telegramToken) {
    try {
      await syncLinkedChats(db, config.telegramToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : "telegram failed";
      console.error(`telegram link sync failed: ${message}`);
    }
  }
  const chats = alertChatIds(db, config);
  const due = listDueIncidents(db, new Date().toISOString());
  const notified: string[] = [];
  for (const incident of due) {
    if (!claimNotification(db, incident.id)) continue;
    const current = incidentById(db, incident.id);
    if (!current?.pendingKind) continue;
    const events = eventsByIds(db, current.eventIds);
    const replay = events.filter((event) => event.origin === "replay").length;
    const origin = replay === 0 ? "live" : replay === events.length ? "replay" : "mixed";
    const text = alertText(toIncident(current), config.publicBaseUrl, current.pendingKind, origin);
    const kind = current.pendingKind;
    const already = deliveredChats(db, current.id, kind);
    let failed = chats.length === 0;
    if (chats.length === 0) console.error(`telegram notify failed for ${current.id}: telegram is not configured`);
    for (const chatId of chats) {
      if (already.has(chatId)) continue;
      try {
        if (send) await send(text);
        else await deliverTelegram(config, chatId, text);
        markDelivered(db, current.id, kind, chatId);
      } catch (err) {
        failed = true;
        const message = err instanceof Error ? err.message : "telegram failed";
        console.error(`telegram notify failed for ${current.id}: ${message}`);
      }
    }
    if (!failed) {
      markSent(current);
      notified.push(current.id);
    } else {
      markFailed(current);
    }
    saveIncident(db, current);
  }
  if (send === undefined && config.telegramToken) await deliverPersonal(db, config);
  return notified;
}
