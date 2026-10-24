/**
 * HTTP transport for remote MCP: one JSON-RPC message per POST /mcp.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../types.ts";
import { createCallTool, handleMcpJsonRpc, type JsonRpcRequest } from "./tools.ts";
import {
  countActiveMcpTokens,
  extractBearerToken,
  verifyMcpToken,
} from "./tokens.ts";

export type McpHttpResult =
  | { kind: "json"; status: number; body: unknown }
  | { kind: "empty"; status: number };

/**
 * Authenticate and handle POST /mcp. Caller must ensure method is POST and path is /mcp.
 */
export async function handleMcpHttp(
  req: IncomingMessage,
  bodyText: string,
  db: DatabaseSync,
  config: Config,
): Promise<McpHttpResult> {
  if (countActiveMcpTokens(db) === 0) {
    return {
      kind: "json",
      status: 503,
      body: { error: "MCP remote disabled — create a token with: sentinell mcp token create" },
    };
  }

  const token = extractBearerToken(req.headers.authorization);
  if (!token || !verifyMcpToken(db, token)) {
    return { kind: "json", status: 401, body: { error: "unauthorized" } };
  }

  let msg: JsonRpcRequest;
  try {
    msg = JSON.parse(bodyText) as JsonRpcRequest;
  } catch {
    return {
      kind: "json",
      status: 400,
      body: {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
    };
  }

  const callTool = createCallTool(db, config);
  const response = await handleMcpJsonRpc(msg, callTool);
  if (!response) {
    return { kind: "empty", status: 204 };
  }
  return { kind: "json", status: 200, body: response };
}

export function sendMcpHttpResult(res: ServerResponse, result: McpHttpResult): void {
  if (result.kind === "empty") {
    res.writeHead(result.status);
    res.end();
    return;
  }
  const payload = JSON.stringify(result.body);
  res.writeHead(result.status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}
