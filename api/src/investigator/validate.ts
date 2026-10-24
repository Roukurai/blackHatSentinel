import { fallbackSummary } from "./fallback.ts";
import type {
  Finding,
  Incident,
  ModelOutput,
  SentinelEvent,
} from "./types.ts";
import { MITRE_ALLOWLIST } from "./types.ts";

const COMPROMISE_RE =
  /compromis|breach|gained access|intrusion confirmed/i;
const HEDGED_RE = /suspect|possible|cannot (confirm|determine)/i;

export interface ValidateResult {
  summary: string;
  findings: Finding[];
  recommendation: string;
  mitre: string[];
  rejected_findings: number;
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
    mitre,
    rejected_findings: rejected,
  };
}
