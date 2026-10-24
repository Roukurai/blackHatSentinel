import type { Incident } from "./types.ts";

const LABELS: Record<string, string> = {
  burst: "burst of failed logins",
  low_and_slow: "low-and-slow failed logins",
  success_after_failures: "success after failures",
  new_source_success: "success from a new source",
};

export function alertText(incident: Incident, publicBaseUrl: string, kind: "new" | "escalation"): string {
  const base = publicBaseUrl.replace(/[\r\n]/g, "").replace(/\/$/, "");
  const pattern = incident.patterns.map((item) => LABELS[item] ?? item).join(", ");
  return [
    kind === "escalation" ? "Sentinel / incident escalated" : "Sentinel / suspicious SSH activity",
    `Host: ${incident.host_id}`,
    `Source: ${incident.source_ip ?? "local"}`,
    `Pattern: ${pattern}`,
    `Severity: ${incident.severity}`,
    "Status: investigation pending",
    `Open incident: ${base}/incidents/${incident.id}`,
  ].join("\n");
}
