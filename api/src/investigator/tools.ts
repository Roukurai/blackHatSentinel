import type { ToolDefinition } from "./llm.ts";
import type {
  HostMetadata,
  Incident,
  InvestigatorDeps,
  SentinelEvent,
} from "./types.ts";
import { FAILURE_EVENT_TYPES } from "./types.ts";

const MAX_EVENTS = 100;
const MAX_USERNAMES = 20;

const FINGERPRINT_RE =
  /Accepted (\w+) for .+? from .+? port \d+ ssh2(?:: \S+ (SHA256:[A-Za-z0-9+/=]+))?/;

export type AuthWindow = "1h" | "24h" | "7d";

export interface SanitizedEvent {
  event_id: string;
  timestamp: string;
  type: string;
  username: string | null;
  source_ip: string | null;
  source_port: number | null;
  origin: "live" | "replay";
  auth_method?: string;
  key_fingerprint?: string;
}

export interface EventAggregate {
  counts_by_type: Record<string, number>;
  distinct_usernames: string[];
  first_seen: string | null;
  last_seen: string | null;
  failed_attempts: number;
}

export interface ToolContext {
  deps: InvestigatorDeps;
  incidentId: string;
  seenEventIds: Set<string>;
  hostIdFallback: string;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_incident_events",
      description:
        "Return sanitized SSH auth events for the incident under investigation (newest 100).",
      parameters: {
        type: "object",
        properties: {
          incident_id: { type: "string" },
        },
        required: ["incident_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_auth_history",
      description:
        "Auth history for exactly one of source_ip or username. window: 1h|24h|7d (max 7d).",
      parameters: {
        type: "object",
        properties: {
          source_ip: { type: "string" },
          username: { type: "string" },
          window: { type: "string", enum: ["1h", "24h", "7d"] },
        },
        required: ["window"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_host_metadata",
      description: "Static host facts for the monitored Ubuntu host.",
      parameters: {
        type: "object",
        properties: {
          host_id: { type: "string" },
        },
        required: ["host_id"],
      },
    },
  },
];

export function sanitizeUsername(username: string | null): string | null {
  if (username === null) return null;
  const cleaned = username.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 64);
  return cleaned;
}

export function extractAuthFields(raw_message: string): {
  auth_method?: string;
  key_fingerprint?: string;
} {
  const m = FINGERPRINT_RE.exec(raw_message);
  if (!m) return {};
  const out: { auth_method?: string; key_fingerprint?: string } = {
    auth_method: m[1],
  };
  if (m[2]) out.key_fingerprint = m[2];
  return out;
}

export function sanitizeEvent(ev: SentinelEvent): SanitizedEvent {
  const auth = ev.type === "ssh_success" ? extractAuthFields(ev.raw_message) : {};
  return {
    event_id: ev.event_id,
    timestamp: ev.timestamp,
    type: ev.type,
    username: sanitizeUsername(ev.username),
    source_ip: ev.source_ip,
    source_port: ev.source_port,
    origin: ev.origin,
    ...auth,
  };
}

export function countFailedAttempts(events: SentinelEvent[]): number {
  const keys = new Set<string>();
  for (const ev of events) {
    if (!FAILURE_EVENT_TYPES.has(ev.type)) continue;
    if (ev.source_ip == null || ev.source_port == null) continue;
    keys.add(`${ev.source_ip}|${ev.source_port}`);
  }
  return keys.size;
}

export function aggregateEvents(events: SentinelEvent[]): EventAggregate {
  const counts_by_type: Record<string, number> = {};
  const users = new Set<string>();
  let first_seen: string | null = null;
  let last_seen: string | null = null;

  for (const ev of events) {
    counts_by_type[ev.type] = (counts_by_type[ev.type] ?? 0) + 1;
    if (ev.username !== null) users.add(sanitizeUsername(ev.username) ?? "");
    if (!first_seen || ev.timestamp < first_seen) first_seen = ev.timestamp;
    if (!last_seen || ev.timestamp > last_seen) last_seen = ev.timestamp;
  }

  return {
    counts_by_type,
    distinct_usernames: [...users].slice(0, MAX_USERNAMES),
    first_seen,
    last_seen,
    failed_attempts: countFailedAttempts(events),
  };
}

function windowMs(window: AuthWindow): number {
  switch (window) {
    case "1h":
      return 3600_000;
    case "24h":
      return 86_400_000;
    case "7d":
      return 7 * 86_400_000;
  }
}

function defaultHostMetadata(host_id: string): HostMetadata {
  return {
    host_id,
    os: "Ubuntu 24.04",
    ssh_password_auth: "disabled (except Match User demo)",
    sentinel_note: "auth logs only; no process/file telemetry",
  };
}

function track(ctx: ToolContext, events: SentinelEvent[]): SanitizedEvent[] {
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const capped = sorted.slice(-MAX_EVENTS);
  for (const ev of capped) ctx.seenEventIds.add(ev.event_id);
  return capped.map(sanitizeEvent);
}

export async function prefetchIncidentEvents(
  ctx: ToolContext,
): Promise<{ incident: Incident; payload: unknown } | { error: string }> {
  const incident = await ctx.deps.getIncident(ctx.incidentId);
  if (!incident) return { error: "incident_not_found" };
  const events = await ctx.deps.getEventsByIds(incident.event_ids);
  const sanitized = track(ctx, events);
  return {
    incident,
    payload: {
      incident_id: incident.id,
      host_id: incident.host_id,
      source_ip: incident.source_ip,
      patterns: incident.patterns,
      severity: incident.severity,
      failed_attempts: incident.failed_attempts,
      events: sanitized,
      aggregate: aggregateEvents(events),
    },
  };
}

export async function executeTool(
  ctx: ToolContext,
  name: string,
  argsJson: string,
): Promise<unknown> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
  } catch {
    return { error: "invalid_json_arguments" };
  }

  if (name === "get_incident_events") {
    const incident_id = String(args.incident_id ?? "");
    if (incident_id !== ctx.incidentId) {
      return { error: "out_of_scope" };
    }
    const pre = await prefetchIncidentEvents(ctx);
    if ("error" in pre) return pre;
    return pre.payload;
  }

  if (name === "get_auth_history") {
    const source_ip =
      typeof args.source_ip === "string" ? args.source_ip : undefined;
    const username =
      typeof args.username === "string" ? args.username : undefined;
    const window = args.window as AuthWindow | undefined;

    if ((source_ip && username) || (!source_ip && !username)) {
      return { error: "provide_exactly_one_of_source_ip_or_username" };
    }
    if (window !== "1h" && window !== "24h" && window !== "7d") {
      return { error: "invalid_window" };
    }

    const now = ctx.deps.now?.() ?? new Date();
    const until = now.toISOString();
    const since = new Date(now.getTime() - windowMs(window)).toISOString();

    const events = await ctx.deps.getAuthHistory({
      source_ip,
      username,
      since,
      until,
      limit: MAX_EVENTS,
    });

    const sanitized = track(ctx, events);

    // Enrich ssh_success with prior_success hints from the returned set
    const priorByFp = new Map<string, number>();
    const priorByIp = new Map<string, number>();
    for (const ev of events) {
      if (ev.type !== "ssh_success") continue;
      const { key_fingerprint } = extractAuthFields(ev.raw_message);
      if (key_fingerprint) {
        priorByFp.set(key_fingerprint, (priorByFp.get(key_fingerprint) ?? 0) + 1);
      }
      if (ev.source_ip) {
        priorByIp.set(ev.source_ip, (priorByIp.get(ev.source_ip) ?? 0) + 1);
      }
    }

    const enriched = sanitized.map((s) => {
      if (s.type !== "ssh_success") return s;
      const fpCount = s.key_fingerprint ? priorByFp.get(s.key_fingerprint) ?? 0 : 0;
      const ipCount = s.source_ip ? priorByIp.get(s.source_ip) ?? 0 : 0;
      return {
        ...s,
        prior_success_same_key: fpCount > 1,
        prior_success_same_ip: ipCount > 1,
      };
    });

    return {
      events: enriched,
      aggregate: aggregateEvents(events),
      window,
      since,
      until,
    };
  }

  if (name === "get_host_metadata") {
    const host_id = String(args.host_id ?? ctx.hostIdFallback);
    let meta: HostMetadata | null = null;
    if (ctx.deps.getHostMetadata) {
      meta = await ctx.deps.getHostMetadata(host_id);
    }
    return meta ?? defaultHostMetadata(host_id || ctx.hostIdFallback);
  }

  return { error: "unknown_tool" };
}
