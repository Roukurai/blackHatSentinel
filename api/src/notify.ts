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

function rememberChat(db: DatabaseSync, chatId: string): void {
  db.prepare("INSERT OR IGNORE INTO telegram_recipients (chat_id, added_at) VALUES (?, ?)").run(
    chatId,
    new Date().toISOString(),
  );
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

async function discoverPrivateChats(db: DatabaseSync, token: string): Promise<void> {
  const row = db.prepare("SELECT update_offset FROM telegram_offset WHERE id = 1").get() as { update_offset: number } | undefined;
  const offset = row?.update_offset ?? 0;
  const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
  url.searchParams.set("timeout", "0");
  url.searchParams.set("allowed_updates", JSON.stringify(["message"]));
  if (offset > 0) url.searchParams.set("offset", String(offset));
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const payload = await response.json() as {
    ok?: boolean;
    result?: Array<{ update_id: number; message?: { chat?: { id?: number; type?: string } } }>;
  };
  if (!payload.ok || !payload.result) return;
  let next = offset;
  for (const update of payload.result) {
    next = Math.max(next, update.update_id + 1);
    const chat = update.message?.chat;
    if (chat?.type === "private" && chat.id !== undefined) rememberChat(db, String(chat.id));
  }
  if (next === offset) return;
  db.prepare(`
    INSERT INTO telegram_offset (id, update_offset) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET update_offset = excluded.update_offset
  `).run(next);
}

async function recipientChats(db: DatabaseSync, config: Config, discover: boolean): Promise<string[]> {
  ensureTelegramTables(db);
  for (const id of configuredChatIds(config)) rememberChat(db, id);
  if (discover && config.telegramToken) {
    try {
      await discoverPrivateChats(db, config.telegramToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : "telegram failed";
      console.error(`telegram recipient sync failed: ${message}`);
    }
  }
  const rows = db.prepare("SELECT chat_id FROM telegram_recipients ORDER BY added_at, chat_id").all() as Array<{ chat_id: string }>;
  return rows.map((row) => row.chat_id);
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
  const chats = await recipientChats(db, config, send === undefined);
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
  return notified;
}
