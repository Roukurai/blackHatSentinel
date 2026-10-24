import type { DatabaseSync } from "node:sqlite";
import { alertText } from "./alert.ts";
import {
  claimNotification,
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

export async function flushNotifications(db: DatabaseSync, config: Config, send?: SendText): Promise<void> {
  const deliver = send ?? ((text: string) => deliverTelegram(config, text));
  const due = listDueIncidents(db, new Date().toISOString());
  for (const incident of due) {
    if (!claimNotification(db, incident.id)) continue;
    const current = incidentById(db, incident.id);
    if (!current?.pendingKind) continue;
    const text = alertText(toIncident(current), config.publicBaseUrl, current.pendingKind);
    try {
      await deliver(text);
      markSent(current);
    } catch (err) {
      const message = err instanceof Error ? err.message : "telegram failed";
      console.error(`telegram notify failed for ${current.id}: ${message}`);
      markFailed(current);
    }
    saveIncident(db, current);
  }
}
