import type { DatabaseSync } from "node:sqlite";
import {
  eventsForKey,
  insertIgnoreEvent,
  insertIncident,
  nextIncidentSeq,
  openIncidentForKey,
  saveIncident,
  transaction,
  type IncidentRecord,
  type SourceKey,
} from "./db.ts";
import { evaluate } from "./detect.ts";
import type { Config, SentinelEvent } from "./types.ts";
import { validateBatch } from "./validate.ts";

export interface IngestResult {
  accepted: number;
  duplicates: number;
}

const RANK = { low: 1, medium: 2, high: 3 } as const;

export function sourceKey(event: SentinelEvent): SourceKey {
  if (event.source_ip !== null) {
    return { hostId: event.host_id, sourceIp: event.source_ip, usernameKey: null };
  }
  return { hostId: event.host_id, sourceIp: null, usernameKey: event.username ?? "" };
}

function keyId(key: SourceKey): string {
  return `${key.hostId}\n${key.sourceIp ?? ""}\n${key.usernameKey ?? ""}`;
}

function scopeEvents(key: SourceKey, events: SentinelEvent[], config: Config): SentinelEvent[] {
  if (key.sourceIp !== null || events.length === 0) return events;
  const latest = Date.parse(events[events.length - 1].timestamp);
  const start = latest - config.detect.slowWindowMs;
  return events.filter((event) => Date.parse(event.timestamp) >= start);
}

function sameOpenWindow(key: SourceKey, open: IncidentRecord, scoped: SentinelEvent[], config: Config): boolean {
  if (key.sourceIp !== null || scoped.length === 0) return true;
  const latest = Date.parse(scoped[scoped.length - 1].timestamp);
  return latest - Date.parse(open.lastSeen) <= config.detect.slowWindowMs;
}

function scheduleEscalation(current: IncidentRecord, config: Config): void {
  if (current.escalationSent || current.pendingKind !== null) return;
  if (current.notificationLastSentAt === null) return;
  const earliest = Date.parse(current.notificationLastSentAt) + config.notifyCooldownSeconds * 1000;
  current.pendingKind = "escalation";
  current.notificationStatus = "pending";
  current.nextSendAt = Date.now() < earliest ? new Date(earliest).toISOString() : null;
}

export function ingest(db: DatabaseSync, body: unknown, config: Config): IngestResult {
  const events = validateBatch(body);
  return transaction(db, () => {
    let accepted = 0;
    let duplicates = 0;
    const keys: SourceKey[] = [];
    const seen = new Set<string>();
    for (const event of events) {
      if (!insertIgnoreEvent(db, event)) {
        duplicates += 1;
        continue;
      }
      accepted += 1;
      const key = sourceKey(event);
      const id = keyId(key);
      if (seen.has(id)) continue;
      seen.add(id);
      keys.push(key);
    }

    for (const key of keys) {
      const stored = eventsForKey(db, key);
      const scoped = scopeEvents(key, stored, config);
      const detection = evaluate(scoped, config.detect);
      if (!detection) continue;
      let open = openIncidentForKey(db, key);
      if (open && !sameOpenWindow(key, open, scoped, config)) open = null;
      if (!open) {
        const seq = nextIncidentSeq(db);
        insertIncident(db, {
          id: `inc-${String(seq).padStart(3, "0")}`,
          seq,
          hostId: key.hostId,
          sourceIp: key.sourceIp,
          usernameKey: key.usernameKey,
          usernames: detection.usernames,
          patterns: detection.patterns,
          severity: detection.severity,
          status: "new",
          firstSeen: detection.firstSeen,
          lastSeen: detection.lastSeen,
          eventIds: detection.eventIds,
          failedAttempts: detection.failedAttempts,
          notificationStatus: "pending",
          notificationAttempts: 0,
          notificationLastAttemptAt: null,
          notificationLastSentAt: null,
          escalationSent: false,
          pendingKind: "new",
          nextSendAt: null,
          notifyClaimed: false,
          investigation: null,
        });
        continue;
      }

      const escalated = RANK[detection.severity] > RANK[open.severity]
        || (detection.patterns.includes("success_after_failures") && !open.patterns.includes("success_after_failures"));
      open.usernames = detection.usernames;
      open.patterns = detection.patterns;
      open.severity = detection.severity;
      open.firstSeen = detection.firstSeen;
      open.lastSeen = detection.lastSeen;
      open.eventIds = detection.eventIds;
      open.failedAttempts = detection.failedAttempts;
      if (escalated) scheduleEscalation(open, config);
      saveIncident(db, open);
    }

    return { accepted, duplicates };
  });
}
