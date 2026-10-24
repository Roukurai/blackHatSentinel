import type { DatabaseSync } from "node:sqlite";
import {
  eventsByIds,
  incidentById,
  matchingEvents,
  saveIncident,
  saveInvestigation,
  toIncident,
} from "./db.ts";
import {
  createInvestigator,
  handleInvestigateRoute,
  healthLlmField,
  loadLlmConfig,
  scheduleInvestigation,
  type Investigation,
  type Investigator,
  type InvestigatorDeps,
} from "./investigator/index.ts";

export function depsFromDatabase(db: DatabaseSync): InvestigatorDeps {
  return {
    getIncident(id) {
      const record = incidentById(db, id);
      if (!record) return null;
      return toIncident(record) as NonNullable<
        Awaited<ReturnType<InvestigatorDeps["getIncident"]>>
      >;
    },
    getEventsByIds(ids) {
      return eventsByIds(db, ids);
    },
    getAuthHistory(q) {
      const filter: { sourceIp?: string; username?: string } = {};
      if (q.source_ip !== undefined) filter.sourceIp = q.source_ip;
      if (q.username !== undefined) filter.username = q.username;
      return matchingEvents(db, filter)
        .filter((event) => event.timestamp >= q.since && event.timestamp <= q.until)
        .slice(0, q.limit);
    },
  };
}

export function createApiInvestigator(db: DatabaseSync): Investigator {
  return createInvestigator(depsFromDatabase(db), loadLlmConfig());
}

export function persistInvestigationResult(
  db: DatabaseSync,
  incidentId: string,
  investigation: Investigation,
): void {
  const status = investigation.status === "ok" ? "investigated" : "new";
  saveInvestigation(db, incidentId, investigation, status);
}

/** Mark investigating and fire-and-forget AI run after Telegram was queued/sent. */
export function enqueueInvestigations(
  investigator: Investigator,
  db: DatabaseSync,
  incidentIds: string[],
): void {
  const unique = [...new Set(incidentIds)];
  for (const id of unique) {
    const record = incidentById(db, id);
    if (!record) continue;
    record.status = "investigating";
    saveIncident(db, record);
    scheduleInvestigation(investigator, id, async (incidentId, inv) => {
      persistInvestigationResult(db, incidentId, inv);
    });
  }
}

export { handleInvestigateRoute, healthLlmField };
