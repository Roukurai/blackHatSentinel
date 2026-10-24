/**
 * Integration helpers for Kevin's API.
 *
 * Usage after notifier is queued (never await before Telegram):
 *
 *   const investigator = createInvestigator(depsFromStore(store), loadLlmConfig());
 *   investigator.startHealthProbe();
 *   scheduleInvestigation(investigator, incident.id, async (id, inv) => {
 *     store.saveInvestigation(id, inv);
 *     store.setStatus(id, inv.status === "ok" ? "investigated" : "new");
 *   });
 */

import type { Investigation, Investigator } from "./types.ts";

export type PersistInvestigation = (
  incidentId: string,
  investigation: Investigation,
) => void | Promise<void>;

async function safePersist(
  persist: PersistInvestigation,
  incidentId: string,
  inv: Investigation,
): Promise<void> {
  try {
    await persist(incidentId, inv);
  } catch (err) {
    console.error(
      "[investigator] persist failed",
      incidentId,
      err instanceof Error ? err.name : "unknown",
    );
  }
}

/** Fire-and-forget investigate; investigate never throws; persist errors are logged. */
export function scheduleInvestigation(
  investigator: Investigator,
  incidentId: string,
  persist: PersistInvestigation,
): void {
  void investigator
    .investigate(incidentId)
    .then((inv) => safePersist(persist, incidentId, inv))
    .catch((err) => {
      // Defensive: investigate is documented never to throw.
      console.error(
        "[investigator] scheduleInvestigation unexpected",
        incidentId,
        err instanceof Error ? err.name : "unknown",
      );
    });
}

/** Handler body for POST /incidents/:id/investigate */
export async function handleInvestigateRoute(
  investigator: Investigator,
  incidentId: string,
  persist?: PersistInvestigation,
): Promise<Investigation> {
  const inv = await investigator.investigate(incidentId);
  if (persist) await safePersist(persist, incidentId, inv);
  return inv;
}

/** Map for GET /health */
export function healthLlmField(investigator: Investigator): "ok" | "down" {
  return investigator.llmHealth();
}
