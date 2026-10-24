import type { DatabaseSync } from "node:sqlite";
import { proposeAction } from "./actions.ts";
import { listDueIncidents } from "./db.ts";
import { enqueueInvestigations } from "./investigate.ts";
import type { Investigator } from "./investigator/index.ts";
import { flushNotifications, type SendText } from "./notify.ts";
import type { Config } from "./types.ts";

/**
 * Telegram first (never waits for the AI), then propose a response and start the
 * investigation for every incident that was due an alert, whether or not delivery
 * succeeded: a Telegram outage must not stop the investigation either.
 */
export async function flushAndFollowUp(
  db: DatabaseSync,
  config: Config,
  investigator: Investigator,
  send?: SendText,
): Promise<void> {
  const due = listDueIncidents(db, new Date().toISOString()).map((record) => record.id);
  await flushNotifications(db, config, send);
  if (config.response) {
    for (const id of due) proposeAction(db, id, config.response);
  }
  enqueueInvestigations(investigator, db, due);
}
