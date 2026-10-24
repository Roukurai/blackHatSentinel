import type {
  Incident,
  RemediationStep,
  RootCause,
} from "./types.ts";

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

export function fallbackRootCause(incident: Incident): RootCause {
  const evidence = incident.event_ids.slice(0, 10);
  const patterns = new Set(incident.patterns);

  if (patterns.has("success_after_failures")) {
    return {
      kind: "suspected",
      statement:
        "Credential guessing may have succeeded after prior failures; compromise is not confirmed from auth logs alone.",
      evidence,
    };
  }
  if (patterns.has("burst") || patterns.has("low_and_slow")) {
    return {
      kind: "suspected",
      statement:
        "Automated SSH scanning or brute-force attempts against this host from the source IP.",
      evidence,
    };
  }
  if (patterns.has("new_source_success")) {
    return {
      kind: "unknown",
      statement:
        "Successful login from a new source; insufficient auth-log context to determine malicious vs benign.",
      evidence,
    };
  }
  return {
    kind: "unknown",
    statement: "Root cause not determinable from available auth-log patterns.",
    evidence,
  };
}

export function fallbackRemediation(
  incident: Incident,
  opts?: { verificationOnly?: boolean },
): RemediationStep[] {
  const verificationOnly = opts?.verificationOnly === true;
  const steps: RemediationStep[] = [];
  let order = 1;

  const push = (
    text: string,
    urgency: RemediationStep["urgency"],
    mode: RemediationStep["mode"],
    action?: RemediationStep["action"],
  ) => {
    if (steps.length >= 5) return;
    steps.push({ order: order++, text: text.slice(0, 200), urgency, mode, action });
  };

  if (verificationOnly) {
    push("Review the cited auth events and confirm the source IP and usernames.", "medium", "manual");
    push("Check whether the successful login used an expected key or account.", "medium", "manual");
    return steps;
  }

  const patterns = new Set(incident.patterns);

  if (patterns.has("success_after_failures")) {
    push(
      "Rotate credentials for any account that saw failures then a success (e.g. demo user password).",
      "high",
      "manual",
    );
    push("Review sshd Match User / password-auth exceptions for unintended exposure.", "high", "manual");
  } else if (patterns.has("burst") || patterns.has("low_and_slow")) {
    push("Confirm fail2ban/nft rate limits or similar controls cover SSH.", "medium", "manual");
    push("Review sshd config (PasswordAuthentication, PermitRootLogin) for hardening gaps.", "medium", "manual");
  } else if (patterns.has("new_source_success")) {
    push("Verify the new source IP and key fingerprint against known operator access.", "low", "manual");
  } else {
    push("Review the cited events and correlate with expected operator activity.", "low", "manual");
  }

  const canBlock =
    Boolean(incident.source_ip) &&
    (incident.severity === "medium" || incident.severity === "high");
  if (canBlock && incident.source_ip) {
    push(
      `Propose a temporary IP block for ${incident.source_ip} (human approval required; not applied automatically).`,
      "high",
      "automatable",
      { kind: "block_ip", target: incident.source_ip },
    );
  }

  return steps;
}
