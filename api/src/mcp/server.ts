/**
 * Read-only MCP stdio server for Sentinell.
 * Usage: node --experimental-strip-types api/src/mcp/server.ts
 * Or:    sentinell mcp
 */
import { createInterface } from "node:readline";
import { loadConfig } from "../config.ts";
import {
  eventsByIds,
  hasFailedNotification,
  incidentById,
  latestEventTimestamp,
  listIncidentRecords,
  toIncident,
  openDatabase,
} from "../db.ts";
import { depsFromDatabase } from "../investigate.ts";
import {
  executeTool,
  type ToolContext,
} from "../investigator/tools.ts";
import { publicLlmSettings } from "../llm-settings.ts";

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "list_incidents",
    description: "List correlated SSH incidents, newest first (read-only).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_incident",
    description: "Get one incident by id (e.g. inc-001), including investigation if present.",
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

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

function reply(id: JsonRpcId | undefined, result: unknown): void {
  if (id === undefined) return;
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function replyError(id: JsonRpcId | undefined, code: number, message: string): void {
  if (id === undefined) return;
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`,
  );
}

function toolResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const deps = depsFromDatabase(db);

  async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
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
      hostIdFallback: process.env.HOST_ID?.trim() || "ubuntu-01",
    };

    if (name === "get_incident_events" || name === "get_auth_history" || name === "get_host_metadata") {
      if (name === "get_incident_events") {
        ctx.incidentId = String(args.incident_id ?? "");
      }
      return executeTool(ctx, name, JSON.stringify(args));
    }

    return { error: "unknown_tool" };
  }

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      continue;
    }

    const id = msg.id;
    const method = msg.method ?? "";

    try {
      if (method === "initialize") {
        reply(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "sentinell", version: "0.1.0" },
        });
        continue;
      }
      if (method === "notifications/initialized" || method === "initialized") {
        continue;
      }
      if (method === "tools/list") {
        reply(id, { tools: TOOLS });
        continue;
      }
      if (method === "tools/call") {
        const params = (msg.params ?? {}) as {
          name?: string;
          arguments?: Record<string, unknown>;
        };
        const name = params.name ?? "";
        const args = params.arguments ?? {};
        const data = await callTool(name, args);
        reply(id, toolResult(data));
        continue;
      }
      if (method === "ping") {
        reply(id, {});
        continue;
      }
      replyError(id, -32601, `Method not found: ${method}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "internal error";
      replyError(id, -32603, message);
    }
  }

  db.close();
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "fatal";
  console.error(`[sentinell mcp] ${message}`);
  process.exit(1);
});
