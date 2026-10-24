import { useEffect, useState } from "react";
import type { EventType, IncidentStatus, Severity } from "../api/types";

// "2026-10-24 15:51:15Z" — always UTC, matches journal __REALTIME_TIMESTAMP.
export function fmtUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "invalid time";
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

// "15:51:15.123" — time of day in UTC with milliseconds, for timelines.
export function fmtUtcMs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "invalid time";
  return d.toISOString().slice(11, 23);
}

export function relAge(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.round((now - t) / 1000);
  if (s < 0) return `in ${fmtDuration(-s)}`;
  if (s < 5) return "just now";
  return `${fmtDuration(s)} ago`;
}

export function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

// Re-render on a clock so relative times stay fresh even when polled data is unchanged.
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const PATTERN_LABELS: Record<string, string> = {
  burst: "Burst",
  low_and_slow: "Low & slow",
  success_after_failures: "Success after failures",
  new_source_success: "New source login",
  spray: "Username spray",
  privileged_target: "Privileged target",
};

export function patternLabel(p: string): string {
  return PATTERN_LABELS[p] ?? p;
}

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  new: "New",
  investigating: "Investigating",
  investigated: "Investigated",
  action_pending: "Action pending",
  action_applied: "Action applied",
  action_rejected: "Action rejected",
  action_failed: "Action failed",
  closed: "Closed",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const EVENT_LABELS: Record<EventType, string> = {
  ssh_invalid_user: "Invalid user",
  ssh_preauth_disconnect: "Preauth disconnect",
  ssh_failed_password: "Failed password",
  ssh_success: "Login accepted",
  ssh_flood: "Connection flood",
  sudo_denied: "Sudo denied",
  user_created: "User created",
  cron_changed: "Cron changed",
};

export function eventLabel(t: string): string {
  return EVENT_LABELS[t as EventType] ?? t;
}
