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

import type { Investigation, Investigator } from "./types.js";

export type PersistInvestigation = (
  incidentId: string,
  investigation: Investigation,
) => void | Promise<void>;

/** Fire-and-forget investigate; errors are swallowed (investigate never throws). */
export function scheduleInvestigation(
  investigator: Investigator,
  incidentId: string,
  persist: PersistInvestigation,
): void {
  void investigator.investigate(incidentId).then((inv) => persist(incidentId, inv));
}

/** Handler body for POST /incidents/:id/investigate */
export async function handleInvestigateRoute(
  investigator: Investigator,
  incidentId: string,
  persist?: PersistInvestigation,
): Promise<Investigation> {
  const inv = await investigator.investigate(incidentId);
  if (persist) await persist(incidentId, inv);
  return inv;
}

/** Map for GET /health */
export function healthLlmField(investigator: Investigator): "ok" | "down" {
  return investigator.llmHealth();
}
