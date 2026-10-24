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

export const PROTOCOL_VERSION = "2024-11-05";

export const TOOLS = [
  {
    name: "list_incidents",
    description: "List correlated SSH incidents, newest first (read-only).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_incident",
    description:
      "Get one incident by id (e.g. inc-001), including investigation if present. When investigated, investigation may include root_cause and remediation (guidance only — never execute remediation via MCP).",
    inputSchema: {
      type: "object",
      properties: { incident_id: { type: "string" } },
      required: ["incident_id"],
    },
  },
  {
    name: "get_incident_events",
    description: "Sanitized auth events for an incident (newest 100). Cites event_ids only.",
    inputSchema: {
      type: "object",
      properties: { incident_id: { type: "string" } },
      required: ["incident_id"],
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
    },
  },
  {
    name: "get_host_metadata",
    description: "Static facts about the monitored host.",
    inputSchema: {
      type: "object",
      properties: { host_id: { type: "string" } },
      required: ["host_id"],
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

export function createCallTool(db: DatabaseSync, config: Config): CallTool {
  const deps = depsFromDatabase(db);

  return async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "list_incidents") {
      return listIncidentRecords(db).map(toIncident);
    }
    if (name === "get_incident") {
      const id = String(args.incident_id ?? "");
      const record = incidentById(db, id);
      if (!record) return { error: "not_found" };
      return {
        ...toIncident(record),
        events: eventsByIds(db, record.eventIds).map((e) => ({
          event_id: e.event_id,
          timestamp: e.timestamp,
          type: e.type,
          username: e.username,
          source_ip: e.source_ip,
          source_port: e.source_port,
          origin: e.origin,
        })),
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

/** Handle one JSON-RPC request. Returns null for notifications (no response). */
export async function handleMcpJsonRpc(
  msg: JsonRpcRequest,
  callTool: CallTool,
): Promise<JsonRpcResponse | null> {
  const id = msg.id;
  const method = msg.method ?? "";

  if (id === undefined) {
    // notification — no reply
    if (method === "notifications/initialized" || method === "initialized") return null;
    return null;
  }

  try {
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "sentinell", version: "0.1.0" },
        },
      };
    }
    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    }
    if (method === "tools/call") {
      const params = (msg.params ?? {}) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      const name = params.name ?? "";
      const args = params.arguments ?? {};
      const data = await callTool(name, args);
      return { jsonrpc: "2.0", id, result: toolResult(data) };
    }
    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    return { jsonrpc: "2.0", id, error: { code: -32603, message } };
  }
}
