/**
 * Read-only MCP stdio server for Sentinell.
 * Usage: node --experimental-strip-types api/src/mcp/server.ts
 * Or:    sentinell mcp
 */
import { createInterface } from "node:readline";
import { loadConfig } from "../config.ts";
import { openDatabase } from "../db.ts";
import {
  createCallTool,
  handleMcpJsonRpc,
  type JsonRpcRequest,
} from "./tools.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const callTool = createCallTool(db, config);

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

    const outcome = await handleMcpJsonRpc(msg, callTool);
    if (outcome.kind === "notification") continue;
    process.stdout.write(`${JSON.stringify(outcome.response)}\n`);
  }

  db.close();
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "fatal";
  console.error(`[sentinell mcp] ${message}`);
  process.exit(1);
});
