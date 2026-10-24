import type { Incident } from "./types.js";

export function fallbackSummary(incident: Incident, prefix?: string): string {
  const patterns = incident.patterns.length
    ? incident.patterns.join(", ")
    : "none";
  const users = incident.usernames.length
    ? `${incident.usernames.length} distinct username(s)`
    : "no usernames";
  const span = `${incident.first_seen} → ${incident.last_seen}`;
  const body = `host=${incident.host_id}; source=${incident.source_ip ?? "null"}; patterns=${patterns}; failed_attempts=${incident.failed_attempts}; ${users}; span=${span}.`;
  if (prefix) return `${prefix}: ${body}`.slice(0, 600);
  return body.slice(0, 600);
}
