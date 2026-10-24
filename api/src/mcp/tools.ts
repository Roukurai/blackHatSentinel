/**
 * Shared read-only MCP tool definitions and handlers (stdio + HTTP).
 */
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../types.ts";
import {
  eventsByIds,
  hasFailedNotification,
  incidentById,
  latestEventTimestamp,
  listIncidentRecords,
  toIncident,
} from "../db.ts";
import { depsFromDatabase } from "../investigate.ts";
import { executeTool, type ToolContext } from "../investigator/tools.ts";
import { publicLlmSettings } from "../llm-settings.ts";

/** Prefer newest Streamable HTTP versions; keep 2024-11-05 for stdio clients. */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export const PROTOCOL_VERSION = "2025-03-26";

export function negotiateProtocolVersion(clientVersion: unknown): string {
  if (typeof clientVersion === "string" && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(clientVersion)) {
    return clientVersion;
  }
  return PROTOCOL_VERSION;
}

export const TOOLS = [
  {
    name: "list_incidents",
    description:
      "List correlated SSH incidents, newest first (read-only). Optional filters: since/until (ISO-8601) on last_seen, status exact match.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "ISO-8601 lower bound on last_seen (inclusive)" },
        until: { type: "string", description: "ISO-8601 upper bound on last_seen (inclusive)" },
        status: { type: "string", description: "Incident status filter (exact)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_incident",
    description:
      "Get one incident by id (e.g. inc-001): summary fields, timeline of sanitized events, and evidence event_ids. Investigation may include root_cause/remediation (guidance only — never execute via MCP).",
    inputSchema: {
      type: "object",
      properties: {
        incident_id: { type: "string", description: "Incident id (inc-NNN)" },
        id: { type: "string", description: "Alias for incident_id" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_alerts",
    description:
      "Telegram notification history derived from incidents (delivery status pending|sent|failed). Filter by ISO date (YYYY-MM-DD) or since/until on last_attempt_at.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Calendar day UTC YYYY-MM-DD" },
        since: { type: "string", description: "ISO-8601 lower bound on last_attempt_at" },
        until: { type: "string", description: "ISO-8601 upper bound on last_attempt_at" },
        status: {
          type: "string",
          enum: ["pending", "sent", "failed"],
          description: "Notification delivery status",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_investigation",
    description:
      "Return the AI investigation for an incident: findings labeled observed|suspected|unknown, plus summary/recommendation/root_cause/remediation when present. Does not invent event_ids.",
    inputSchema: {
      type: "object",
      properties: {
        incident_id: { type: "string" },
        id: { type: "string", description: "Alias for incident_id" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_incident_events",
    description: "Sanitized auth events for an incident (newest 100). Cites event_ids only.",
    inputSchema: {
      type: "object",
      properties: { incident_id: { type: "string" } },
      required: ["incident_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_auth_history",
    description:
      "Auth history for exactly one of source_ip or username. window: 1h|24h|7d.",
    inputSchema: {
      type: "object",
      properties: {
        source_ip: { type: "string" },
        username: { type: "string" },
        window: { type: "string", enum: ["1h", "24h", "7d"] },
      },
      required: ["window"],
      additionalProperties: false,
    },
  },
  {
    name: "get_host_metadata",
    description: "Static facts about the monitored host.",
    inputSchema: {
      type: "object",
      properties: { host_id: { type: "string" } },
      required: ["host_id"],
      additionalProperties: false,
    },
  },
  {
    name: "health",
    description: "Collector / LLM / Telegram / DB health (no secrets).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

export function toolResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export type CallTool = (name: string, args: Record<string, unknown>) => Promise<unknown>;

function incidentIdOf(args: Record<string, unknown>): string {
  if (typeof args.incident_id === "string" && args.incident_id) return args.incident_id;
  if (typeof args.id === "string" && args.id) return args.id;
  return "";
}

function inRange(iso: string | null, since?: string, until?: string): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  if (since) {
    const s = Date.parse(since);
    if (!Number.isNaN(s) && t < s) return false;
  }
  if (until) {
    const u = Date.parse(until);
    if (!Number.isNaN(u) && t > u) return false;
  }
  return true;
}

export function createCallTool(db: DatabaseSync, config: Config): CallTool {
  const deps = depsFromDatabase(db);

  return async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "list_incidents") {
      const since = typeof args.since === "string" ? args.since : undefined;
      const until = typeof args.until === "string" ? args.until : undefined;
      const status = typeof args.status === "string" ? args.status : undefined;
      return listIncidentRecords(db)
        .filter((r) => (status ? r.status === status : true))
        .filter((r) => (since || until ? inRange(r.lastSeen, since, until) : true))
        .map(toIncident);
    }

    if (name === "get_incident") {
      const id = incidentIdOf(args);
      const record = incidentById(db, id);
      if (!record) return { error: "not_found" };
      const events = eventsByIds(db, record.eventIds).map((e) => ({
        event_id: e.event_id,
        timestamp: e.timestamp,
        type: e.type,
        username: e.username,
        source_ip: e.source_ip,
        source_port: e.source_port,
        origin: e.origin,
      }));
      events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      return {
        ...toIncident(record),
        timeline: events,
        evidence_event_ids: record.eventIds,
        events,
      };
    }

    if (name === "list_alerts") {
      const since = typeof args.since === "string" ? args.since : undefined;
      const until = typeof args.until === "string" ? args.until : undefined;
      const status = typeof args.status === "string" ? args.status : undefined;
      const date = typeof args.date === "string" ? args.date : undefined;
      const dayStart = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00.000Z` : undefined;
      const dayEnd = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T23:59:59.999Z` : undefined;

      return listIncidentRecords(db)
        .filter((r) => r.notificationAttempts > 0 || r.notificationStatus !== "pending" || r.notificationLastAttemptAt)
        .map((r) => ({
          incident_id: r.id,
          host_id: r.hostId,
          source_ip: r.sourceIp,
          channel: "telegram" as const,
          status: r.notificationStatus,
          attempts: r.notificationAttempts,
          last_attempt_at: r.notificationLastAttemptAt,
          last_sent_at: r.notificationLastSentAt,
          pending_kind: r.pendingKind,
        }))
        .filter((a) => (status ? a.status === status : true))
        .filter((a) => {
          const ts = a.last_attempt_at ?? a.last_sent_at;
          if (dayStart || dayEnd) return inRange(ts, dayStart, dayEnd);
          if (since || until) return inRange(ts, since, until);
          return true;
        });
    }

    if (name === "get_investigation") {
      const id = incidentIdOf(args);
      const record = incidentById(db, id);
      if (!record) return { error: "not_found" };
      if (!record.investigation) {
        return {
          incident_id: id,
          investigation: null,
          message: "no investigation persisted yet",
        };
      }
      const inv = record.investigation;
      return {
        incident_id: id,
        status: inv.status,
        summary: inv.summary,
        findings: inv.findings,
        recommendation: inv.recommendation,
        root_cause: inv.root_cause ?? null,
        remediation: inv.remediation ?? null,
        mitre: inv.mitre,
        model: inv.model,
        created_at: inv.created_at,
      };
    }

    if (name === "health") {
      return {
        collector_last_event_at: latestEventTimestamp(db),
        llm: publicLlmSettings(config.llmSettingsPath).configured ? "configured" : "down",
        telegram:
          config.telegramToken && config.telegramChatId && !hasFailedNotification(db)
            ? "ok"
            : "failed",
        db: "ok",
      };
    }

    const incidentId =
      typeof args.incident_id === "string" && args.incident_id
        ? args.incident_id
        : "mcp";
    const ctx: ToolContext = {
      deps,
      incidentId,
      seenEventIds: new Set(),
      hostIdFallback: config.hostId?.trim() || process.env.HOST_ID?.trim() || "ubuntu-01",
    };

    if (name === "get_incident_events" || name === "get_auth_history" || name === "get_host_metadata") {
      if (name === "get_incident_events") {
        ctx.incidentId = String(args.incident_id ?? "");
      }
      return executeTool(ctx, name, JSON.stringify(args));
    }

    return { error: "unknown_tool" };
  };
}

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string } };

export type McpJsonRpcOutcome =
  | { kind: "response"; response: JsonRpcResponse; isInitialize?: boolean }
  | { kind: "notification" }
  | { kind: "error"; response: JsonRpcResponse };

/** Handle one JSON-RPC request. */
export async function handleMcpJsonRpc(
  msg: JsonRpcRequest,
  callTool: CallTool,
): Promise<McpJsonRpcOutcome> {
  const id = msg.id;
  const method = msg.method ?? "";

  if (id === undefined) {
    if (method === "notifications/initialized" || method === "initialized") {
      return { kind: "notification" };
    }
    return { kind: "notification" };
  }

  try {
    if (method === "initialize") {
      const params = (msg.params ?? {}) as { protocolVersion?: string };
      const protocolVersion = negotiateProtocolVersion(params.protocolVersion);
      return {
        kind: "response",
        isInitialize: true,
        response: {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "sentinell", version: "0.1.0" },
          },
        },
      };
    }
    if (method === "tools/list") {
      return {
        kind: "response",
        response: { jsonrpc: "2.0", id, result: { tools: TOOLS } },
      };
    }
    if (method === "tools/call") {
      const params = (msg.params ?? {}) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      const name = params.name ?? "";
      const args = params.arguments ?? {};
      const data = await callTool(name, args);
      return {
        kind: "response",
        response: { jsonrpc: "2.0", id, result: toolResult(data) },
      };
    }
    if (method === "ping") {
      return { kind: "response", response: { jsonrpc: "2.0", id, result: {} } };
    }
    return {
      kind: "error",
      response: { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    return {
      kind: "error",
      response: { jsonrpc: "2.0", id, error: { code: -32603, message } },
    };
  }
}
