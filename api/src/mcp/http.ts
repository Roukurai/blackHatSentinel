/**
 * MCP Streamable HTTP transport (2025-03-26 / 2025-06-18 subset).
 * POST /mcp — JSON-RPC; GET /mcp — 405 (no SSE stream); OPTIONS — CORS.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../types.ts";
import { createMcpSession, mcpSessionValid } from "./session.ts";
import { createCallTool, handleMcpJsonRpc, type JsonRpcRequest } from "./tools.ts";
import {
  countActiveMcpTokens,
  extractMcpToken,
  verifyMcpToken,
} from "./tokens.ts";

export type McpHttpResult = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** empty body (e.g. 202 notification) */
  empty?: boolean;
  /** send body as a single SSE message event */
  sse?: boolean;
};

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers":
    "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version",
  "access-control-expose-headers": "Mcp-Session-Id",
  "access-control-max-age": "86400",
};

export function mcpCorsHeaders(): Record<string, string> {
  return { ...CORS_HEADERS };
}

function wantsSse(req: IncomingMessage): boolean {
  const accept = (req.headers.accept ?? "").toLowerCase();
  if (!accept) return false;
  if (accept.includes("text/event-stream") && !accept.includes("application/json")) return true;
  // Prefer SSE when listed first
  const jsonIdx = accept.indexOf("application/json");
  const sseIdx = accept.indexOf("text/event-stream");
  return sseIdx >= 0 && (jsonIdx < 0 || sseIdx < jsonIdx);
}

function sessionHeader(req: IncomingMessage): string | undefined {
  const raw = req.headers["mcp-session-id"];
  if (typeof raw === "string") return raw.trim() || undefined;
  if (Array.isArray(raw) && raw[0]) return String(raw[0]).trim() || undefined;
  return undefined;
}

/**
 * Authenticate and handle POST /mcp.
 */
export async function handleMcpHttp(
  req: IncomingMessage,
  bodyText: string,
  db: DatabaseSync,
  config: Config,
): Promise<McpHttpResult> {
  const cors = mcpCorsHeaders();

  if (countActiveMcpTokens(db) === 0) {
    return {
      status: 503,
      headers: cors,
      body: { error: "MCP remote disabled — create a token with: sentinell mcp token create" },
    };
  }

  const token = extractMcpToken(req.headers.authorization);
  if (!token || !verifyMcpToken(db, token)) {
    return { status: 401, headers: cors, body: { error: "unauthorized" } };
  }

  let msg: JsonRpcRequest;
  try {
    msg = JSON.parse(bodyText || "{}") as JsonRpcRequest;
  } catch {
    return {
      status: 400,
      headers: cors,
      body: {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
    };
  }

  const method = msg.method ?? "";
  const incomingSession = sessionHeader(req);

  // Invalid session id → 404 per Streamable HTTP guidance
  if (incomingSession && !mcpSessionValid(incomingSession) && method !== "initialize") {
    return { status: 404, headers: cors, body: { error: "session not found" } };
  }

  const callTool = createCallTool(db, config);
  const outcome = await handleMcpJsonRpc(msg, callTool);

  if (outcome.kind === "notification") {
    return {
      status: 202,
      empty: true,
      headers: {
        ...cors,
        ...(incomingSession ? { "mcp-session-id": incomingSession } : {}),
      },
    };
  }

  const headers: Record<string, string> = { ...cors };
  if (outcome.kind === "response" && outcome.isInitialize) {
    headers["mcp-session-id"] = createMcpSession();
  } else if (incomingSession) {
    headers["mcp-session-id"] = incomingSession;
  }

  return {
    status: 200,
    body: outcome.response,
    headers,
    sse: wantsSse(req),
  };
}

export function handleMcpOptions(): McpHttpResult {
  return { status: 204, empty: true, headers: mcpCorsHeaders() };
}

export function handleMcpGet(): McpHttpResult {
  return {
    status: 405,
    headers: {
      ...mcpCorsHeaders(),
      allow: "POST, OPTIONS",
    },
    body: { error: "SSE streaming not supported; use POST /mcp" },
  };
}

export function sendMcpHttpResult(res: ServerResponse, result: McpHttpResult): void {
  const headers: Record<string, string> = { ...(result.headers ?? {}) };
  if (result.empty) {
    res.writeHead(result.status, headers);
    res.end();
    return;
  }
  const payload = JSON.stringify(result.body ?? {});
  if (result.sse) {
    headers["content-type"] = "text/event-stream; charset=utf-8";
    headers["cache-control"] = "no-cache";
    res.writeHead(result.status, headers);
    res.end(`event: message\ndata: ${payload}\n\n`);
    return;
  }
  headers["content-type"] = "application/json; charset=utf-8";
  res.writeHead(result.status, headers);
  res.end(payload);
}
