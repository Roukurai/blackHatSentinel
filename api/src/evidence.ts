import type { DatabaseSync } from "node:sqlite";
import { eventsByIds, incidentById, matchingEvents } from "./db.ts";
import type { SentinelEvent } from "./types.ts";

export function getIncidentEvents(db: DatabaseSync, incidentId: string): SentinelEvent[] | null {
  const incident = incidentById(db, incidentId);
  if (!incident) return null;
  return eventsByIds(db, incident.eventIds);
}

export function getAuthHistory(
  db: DatabaseSync,
  query: { sourceIp?: string; username?: string; windowSeconds: number; until?: string },
): SentinelEvent[] {
  const events = matchingEvents(db, { sourceIp: query.sourceIp, username: query.username });
  if (events.length === 0) return [];
  const end = query.until ? Date.parse(query.until) : Date.parse(events[events.length - 1].timestamp);
  const start = end - query.windowSeconds * 1000;
  return events.filter((event) => {
    const at = Date.parse(event.timestamp);
    return at >= start && at <= end;
  });
}
