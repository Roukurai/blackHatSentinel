import {
  fallbackRemediation,
  fallbackRootCause,
  fallbackSummary,
} from "./fallback.ts";
import type {
  Finding,
  Incident,
  ModelOutput,
  RemediationStep,
  RootCause,
  SentinelEvent,
  Severity,
} from "./types.ts";
import { MITRE_ALLOWLIST } from "./types.ts";

const COMPROMISE_RE =
  /compromis|breach|gained access|intrusion confirmed/i;
const HEDGED_RE = /suspect|possible|cannot (confirm|determine)/i;

export interface ValidateResult {
  summary: string;
  findings: Finding[];
  recommendation: string;
  root_cause: RootCause;
  remediation: RemediationStep[];
  mitre: string[];
  rejected_findings: number;
}

function sanitizeRootCause(
  raw: RootCause | undefined,
  incident: Incident,
  seenEventIds: Set<string>,
): { root_cause: RootCause; limited: boolean } {
  if (!raw) {
    return { root_cause: fallbackRootCause(incident), limited: false };
  }

  const evidence = [...new Set(raw.evidence.filter(Boolean))];
  const allKnown = evidence.every((id) => seenEventIds.has(id));
  let limited = false;

  if (!allKnown) {
    limited = true;
    return {
      root_cause: {
        kind: "unknown",
        statement: "Root cause not determinable from cited evidence.",
        evidence: [],
      },
      limited,
    };
  }

  if (
    (raw.kind === "observed" || raw.kind === "suspected") &&
    evidence.length === 0
  ) {
    limited = true;
    return {
      root_cause: {
        kind: "unknown",
        statement: "Root cause not determinable from cited evidence.",
        evidence: [],
      },
      limited,
    };
  }

  if (
    raw.kind === "observed" &&
    COMPROMISE_RE.test(raw.statement) &&
    !HEDGED_RE.test(raw.statement)
  ) {
    limited = true;
    return {
      root_cause: {
        kind: "unknown",
        statement: "Root cause not determinable from cited evidence.",
        evidence: [],
      },
      limited,
    };
  }

  return {
    root_cause: {
      kind: raw.kind,
      statement: raw.statement.slice(0, 300),
      evidence,
    },
    limited: raw.kind === "unknown",
  };
}

function sanitizeRemediation(
  raw: RemediationStep[] | undefined,
  incident: Incident,
  limited: boolean,
): RemediationStep[] {
  if (limited) {
    return fallbackRemediation(incident, { verificationOnly: true });
  }

  const sourceIp = incident.source_ip;
  const out: RemediationStep[] = [];

  for (const step of (raw ?? []).slice(0, 5)) {
    const urgency: Severity =
      step.urgency === "low" || step.urgency === "high" || step.urgency === "medium"
        ? step.urgency
        : "medium";
    let mode = step.mode === "automatable" ? "automatable" : "manual";
    let action = step.action;

    if (
      mode === "automatable" &&
      action &&
      action.kind === "block_ip" &&
      sourceIp &&
      action.target === sourceIp
    ) {
      action = { kind: "block_ip", target: sourceIp };
    } else {
      mode = "manual";
      action = undefined;
    }

    out.push({
      order: out.length + 1,
      text: step.text.slice(0, 200),
      urgency,
      mode,
      ...(action ? { action } : {}),
    });
  }

  if (out.length === 0) {
    return fallbackRemediation(incident);
  }
  return out;
}

export function validateModelOutput(
  output: ModelOutput,
  incident: Incident,
  seenEventIds: Set<string>,
  events: SentinelEvent[],
): ValidateResult {
  let rejected = 0;
  const findings: Finding[] = [];

  for (const f of output.findings.slice(0, 8)) {
    const evidence = [...new Set(f.evidence.filter(Boolean))];
    const allKnown = evidence.every((id) => seenEventIds.has(id));

    if (!allKnown) {
      rejected++;
      continue;
    }

    if (
      (f.kind === "observed" || f.kind === "suspected") &&
      evidence.length === 0
    ) {
      rejected++;
      continue;
    }

    if (f.kind === "observed" && COMPROMISE_RE.test(f.statement)) {
      rejected++;
      continue;
    }

    findings.push({
      kind: f.kind,
      statement: f.statement.slice(0, 300),
      evidence,
    });
  }

  const successIds = events
    .filter((e) => e.type === "ssh_success")
    .map((e) => e.event_id)
    .filter((id) => seenEventIds.has(id));

  if (successIds.length > 0) {
    const already = findings.some(
      (f) =>
        f.kind === "unknown" &&
        /post-login|compromise is not confirmed/i.test(f.statement),
    );
    if (!already) {
      findings.push({
        kind: "unknown",
        statement:
          "Auth logs cannot show post-login activity; compromise is not confirmed.",
        evidence: successIds,
      });
    }
  }

  let summary = output.summary.slice(0, 600);
  if (COMPROMISE_RE.test(summary) && !HEDGED_RE.test(summary)) {
    summary = fallbackSummary(incident);
  }

  const { root_cause, limited } = sanitizeRootCause(
    output.root_cause,
    incident,
    seenEventIds,
  );
  const remediation = sanitizeRemediation(
    output.remediation,
    incident,
    limited,
  );

  const mitre = [
    ...new Set(
      output.mitre.filter(
        (id) => /^T\d{4}(\.\d{3})?$/.test(id) && MITRE_ALLOWLIST.has(id),
      ),
    ),
  ];

  return {
    summary,
    findings: findings.slice(0, 8),
    recommendation: output.recommendation.slice(0, 400),
    root_cause,
    remediation,
    mitre,
    rejected_findings: rejected,
  };
}
