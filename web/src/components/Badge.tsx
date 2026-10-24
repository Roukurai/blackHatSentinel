import type { IncidentStatus, NotificationStatus, Origin, Severity } from "../api/types";
import { patternLabel, SEVERITY_LABELS, STATUS_LABELS } from "../lib/format";
import { GBadge, StatusDot, type Tone } from "./ui";

// Signal (the "blue" tone slot) is reserved for attention; low severity stays neutral.
const SEVERITY_TONE: Record<Severity, Tone> = { high: "red", medium: "amber", low: "gray" };

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <GBadge tone={SEVERITY_TONE[severity] ?? "gray"}>{SEVERITY_LABELS[severity] ?? severity}</GBadge>;
}

const STATUS_TONE: Record<IncidentStatus, Tone> = {
  new: "blue",
  investigating: "amber",
  investigated: "gray",
  action_pending: "amber",
  action_applied: "green",
  action_rejected: "gray",
  action_failed: "red",
  closed: "gray",
};

export function IncidentStatusDot({ status }: { status: IncidentStatus }) {
  return <StatusDot tone={STATUS_TONE[status] ?? "gray"} label={STATUS_LABELS[status] ?? status} pulse={status === "investigating"} />;
}

const NOTIF: Record<NotificationStatus, { tone: Tone; label: string }> = {
  sent: { tone: "green", label: "Delivered" },
  pending: { tone: "gray", label: "Pending" },
  failed: { tone: "red", label: "Failed" },
};

export function NotificationDot({ status }: { status: NotificationStatus }) {
  const n = NOTIF[status] ?? { tone: "gray" as const, label: status };
  return <StatusDot tone={n.tone} label={n.label} />;
}

// Rendered only when origin is known; live is the unmarked default.
export function OriginBadge({ origin }: { origin: Origin | "mixed" | undefined }) {
  if (origin === "replay")
    return (
      <GBadge tone="purple" title="Replayed log data, not live">
        Replay
      </GBadge>
    );
  if (origin === "mixed")
    return (
      <GBadge tone="purple" title="Contains replayed events">
        Mixed
      </GBadge>
    );
  return null;
}

export function PatternBadge({ pattern }: { pattern: string }) {
  return <GBadge tone={pattern === "success_after_failures" ? "amber" : "gray"}>{patternLabel(pattern)}</GBadge>;
}
