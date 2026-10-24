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

async function deliverTelegram(config: Config, text: string): Promise<void> {
  if (!config.telegramToken || !config.telegramChatId) {
    throw new Error("telegram is not configured");
  }
  const response = await fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: config.telegramChatId,
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
  const deliver = send ?? ((text: string) => deliverTelegram(config, text));
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
    try {
      await deliver(text);
      markSent(current);
      notified.push(current.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "telegram failed";
      console.error(`telegram notify failed for ${current.id}: ${message}`);
      markFailed(current);
    }
    saveIncident(db, current);
  }
  return notified;
}
