import type {
  AuthHistoryQuery,
  HostMetadata,
  Incident,
  InvestigatorDeps,
  MaybePromise,
  SentinelEvent,
} from "./types.ts";

/**
 * Minimal store surface Kevin's SQLite layer should expose.
 * Hugo maps this onto InvestigatorDeps — no SQL lives in the investigator folder.
 */
export interface InvestigatorStore {
  getIncident(id: string): MaybePromise<Incident | null>;
  getEventsByIds(ids: string[]): MaybePromise<SentinelEvent[]>;
  /**
   * Auth history for exactly one of source_ip or username within [since, until],
   * ordered by timestamp ascending, capped by limit. Include `origin` on every row.
   */
  getAuthHistory(q: AuthHistoryQuery): MaybePromise<SentinelEvent[]>;
  getHostMetadata?(host_id: string): MaybePromise<HostMetadata | null>;
  now?(): Date;
}

/** Adapt Kevin's store to InvestigatorDeps for createInvestigator(...). */
export function depsFromStore(store: InvestigatorStore): InvestigatorDeps {
  return {
    getIncident: (id) => store.getIncident(id),
    getEventsByIds: (ids) => store.getEventsByIds(ids),
    getAuthHistory: (q) => store.getAuthHistory(q),
    getHostMetadata: store.getHostMetadata
      ? (host_id) => store.getHostMetadata!(host_id)
      : undefined,
    now: store.now ? () => store.now!() : undefined,
  };
}
