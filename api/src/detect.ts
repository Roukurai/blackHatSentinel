import { FAILURE_TYPES, type DetectConfig, type Pattern, type SentinelEvent, type Severity } from "./types.ts";

const FAILURE = new Set<string>(FAILURE_TYPES);
const ORDER: Pattern[] = ["burst", "low_and_slow", "success_after_failures", "new_source_success"];

export interface Detection {
  patterns: Pattern[];
  severity: Severity;
  failedAttempts: number;
  eventIds: string[];
  usernames: string[];
  firstSeen: string;
  lastSeen: string;
}

// One failed attempt is a distinct (source_ip, source_port). A missing port does not
// collapse unrelated lines onto the same attempt.
export function attemptKey(event: SentinelEvent): string {
  const port = event.source_port === null ? `event:${event.event_id}` : String(event.source_port);
  return `${event.source_ip ?? ""}\n${port}`;
}

function ms(timestamp: string): number {
  return Date.parse(timestamp);
}

function distinctSince(events: SentinelEvent[], startMs: number, endMs: number, exclusiveEnd: boolean): number {
  const keys = new Set<string>();
  for (const event of events) {
    const at = ms(event.timestamp);
    if (at < startMs) continue;
    if (exclusiveEnd ? at >= endMs : at > endMs) continue;
    keys.add(attemptKey(event));
  }
  return keys.size;
}

export function evaluate(events: SentinelEvent[], config: DetectConfig): Detection | null {
  if (events.length === 0) return null;
  const ordered = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.event_id.localeCompare(b.event_id));
  const failures = ordered.filter((event) => FAILURE.has(event.type));
  const successes = ordered.filter((event) => event.type === "ssh_success");
  const matched = new Set<Pattern>();

  for (const failure of failures) {
    const end = ms(failure.timestamp);
    if (distinctSince(failures, end - config.fastWindowMs, end, false) >= config.fastCount) matched.add("burst");
    if (distinctSince(failures, end - config.slowWindowMs, end, false) >= config.slowCount) matched.add("low_and_slow");
  }
  for (const success of successes) {
    const end = ms(success.timestamp);
    if (distinctSince(failures, end - config.slowWindowMs, end, true) >= 1) matched.add("success_after_failures");
  }
  if (successes.length > 0) matched.add("new_source_success");

  const patterns = ORDER.filter((pattern) => matched.has(pattern));
  if (patterns.length === 0) return null;

  const usernames: string[] = [];
  const seenNames = new Set<string>();
  for (const event of ordered) {
    if (event.username === null || seenNames.has(event.username)) continue;
    seenNames.add(event.username);
    usernames.push(event.username);
    if (usernames.length === 50) break;
  }

  const severity: Severity = patterns.includes("success_after_failures")
    ? "high"
    : patterns.includes("burst")
      ? "medium"
      : "low";

  return {
    patterns,
    severity,
    failedAttempts: new Set(failures.map(attemptKey)).size,
    eventIds: ordered.map((event) => event.event_id),
    usernames,
    firstSeen: ordered[0].timestamp,
    lastSeen: ordered[ordered.length - 1].timestamp,
  };
}
