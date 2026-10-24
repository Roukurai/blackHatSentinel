import type { Incident } from "./types.ts";

const LABELS: Record<string, string> = {
  burst: "burst of failed logins",
  low_and_slow: "low-and-slow failed logins",
  success_after_failures: "success after failures",
  new_source_success: "success from a new source",
};

function clean(value: string): string {
  return value.replace(/[\r\n]/g, " ");
}

function when(iso: string): string {
  return clean(iso).replace("T", " ").replace(/\.\d+Z$/, " UTC").replace(/Z$/, " UTC");
}

export function alertText(
  incident: Incident,
  publicBaseUrl: string,
  kind: "new" | "escalation",
  origin: "live" | "replay" | "mixed" = "live",
): string {
  const base = publicBaseUrl.replace(/[\r\n]/g, "").replace(/\/$/, "");
  const pattern = incident.patterns.map((item) => LABELS[item] ?? item).join(", ");
  return [
    kind === "escalation" ? "Sentinel / incident escalated" : "Sentinel / suspicious SSH activity",
    `Host: ${clean(incident.host_id)}`,
    `Source: ${clean(incident.source_ip ?? "local")}`,
    `Pattern: ${pattern}`,
    `Severity: ${incident.severity}`,
    `Incident: ${clean(incident.id)}`,
    `From: ${when(incident.first_seen)}`,
    `To: ${when(incident.last_seen)}`,
    `Failed attempts: ${incident.failed_attempts}`,
    `Events: ${incident.event_ids.length}`,
    `Accounts tried: ${incident.usernames.length}`,
    `Origin: ${origin}`,
    "Status: investigation pending",
    `Open incident: ${base}/incidents/${incident.id}`,
  ].join("\n");
}
