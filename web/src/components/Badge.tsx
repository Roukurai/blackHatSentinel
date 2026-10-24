import type { IncidentStatus, Origin, Severity } from "../api/types";
import { SEVERITY_LABELS, STATUS_LABELS } from "../lib/format";

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge badge--sev-${severity}`}>{SEVERITY_LABELS[severity] ?? severity}</span>;
}

export function StatusBadge({ status }: { status: IncidentStatus }) {
  return <span className={`badge badge--status badge--st-${status}`}>{STATUS_LABELS[status] ?? status}</span>;
}

// Rendered only when origin is known; live is the unmarked default.
export function OriginBadge({ origin }: { origin: Origin | "mixed" | undefined }) {
  if (origin === "replay") return <span className="badge badge--replay" title="Replayed log data, not live">Replay</span>;
  if (origin === "mixed") return <span className="badge badge--replay" title="Contains replayed events">Mixed</span>;
  return null;
}

export function Chip({ children, tone }: { children: string; tone?: "warn" }) {
  return <span className={`chip${tone ? ` chip--${tone}` : ""}`}>{children}</span>;
}
