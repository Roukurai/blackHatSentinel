/**
 * In-memory MCP Streamable HTTP sessions (Mcp-Session-Id).
 */
import { randomBytes } from "node:crypto";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map<string, number>();

function prune(now = Date.now()): void {
  for (const [id, created] of sessions) {
    if (now - created > SESSION_TTL_MS) sessions.delete(id);
  }
}

export function createMcpSession(): string {
  prune();
  const id = randomBytes(16).toString("hex");
  sessions.set(id, Date.now());
  return id;
}

export function mcpSessionValid(id: string | undefined): boolean {
  if (!id) return false;
  prune();
  const created = sessions.get(id);
  if (created === undefined) return false;
  if (Date.now() - created > SESSION_TTL_MS) {
    sessions.delete(id);
    return false;
  }
  return true;
}

/** Test helper */
export function clearMcpSessions(): void {
  sessions.clear();
}
