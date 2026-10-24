/**
 * MCP Bearer tokens — plaintext shown once; only sha256 hash stored.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sha256_hash TEXT NOT NULL UNIQUE,
  last4 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_hash ON mcp_tokens (sha256_hash);
`;

export const TOKEN_PREFIX = "sntl_mcp_";

export interface McpTokenMeta {
  id: string;
  name: string;
  last4: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
}

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function ensureMcpTokensTable(db: DatabaseSync): void {
  db.exec(SCHEMA);
}

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function mapMeta(row: Row): McpTokenMeta {
  return {
    id: String(row.id),
    name: String(row.name),
    last4: String(row.last4),
    created_at: String(row.created_at),
    last_used_at: text(row.last_used_at),
    revoked_at: text(row.revoked_at),
    expires_at: text(row.expires_at),
  };
}

/** Count non-revoked, non-expired tokens. */
export function countActiveMcpTokens(db: DatabaseSync, now = new Date()): number {
  ensureMcpTokensTable(db);
  const nowIso = now.toISOString();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM mcp_tokens
       WHERE revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .get(nowIso) as Row;
  return Number(row.n ?? 0);
}

export function createMcpToken(
  db: DatabaseSync,
  name: string,
  options: { expiresAt?: string | null } = {},
): { token: string; meta: McpTokenMeta } {
  ensureMcpTokensTable(db);
  const trimmed = name.trim();
  if (!trimmed) throw new Error("token name is required");

  const raw = randomBytes(32).toString("base64url");
  const token = `${TOKEN_PREFIX}${raw}`;
  const sha256 = hashMcpToken(token);
  const last4 = token.slice(-4);
  const id = `mcp-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const created_at = new Date().toISOString();
  const expires_at = options.expiresAt ?? null;

  db.prepare(
    `INSERT INTO mcp_tokens (id, name, sha256_hash, last4, created_at, last_used_at, revoked_at, expires_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
  ).run(id, trimmed, sha256, last4, created_at, expires_at);

  return {
    token,
    meta: {
      id,
      name: trimmed,
      last4,
      created_at,
      last_used_at: null,
      revoked_at: null,
      expires_at,
    },
  };
}

export function listMcpTokens(db: DatabaseSync): McpTokenMeta[] {
  ensureMcpTokensTable(db);
  const rows = db
    .prepare(`SELECT * FROM mcp_tokens ORDER BY created_at DESC`)
    .all() as Row[];
  return rows.map(mapMeta);
}

export function revokeMcpToken(db: DatabaseSync, id: string): boolean {
  ensureMcpTokensTable(db);
  const now = new Date().toISOString();
  const result = db
    .prepare(`UPDATE mcp_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
    .run(now, id);
  return Number(result.changes) > 0;
}

/**
 * Verify MCP token. Updates last_used_at on success.
 * Uses timing-safe compare against stored hash. Never log the token.
 */
export function verifyMcpToken(db: DatabaseSync, token: string, now = new Date()): boolean {
  ensureMcpTokensTable(db);
  if (!token.startsWith(TOKEN_PREFIX)) return false;

  const hashHex = hashMcpToken(token);
  const row = db
    .prepare(`SELECT id, sha256_hash, revoked_at, expires_at FROM mcp_tokens WHERE sha256_hash = ?`)
    .get(hashHex) as Row | undefined;

  if (!row) {
    const dummy = Buffer.from(hashHex, "hex");
    timingSafeEqual(dummy, dummy);
    return false;
  }

  const stored = Buffer.from(String(row.sha256_hash), "hex");
  const incoming = Buffer.from(hashHex, "hex");
  if (stored.length !== incoming.length || !timingSafeEqual(stored, incoming)) {
    return false;
  }

  if (text(row.revoked_at)) return false;
  const expires = text(row.expires_at);
  if (expires && Date.parse(expires) <= now.getTime()) return false;

  db.prepare(`UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?`).run(
    now.toISOString(),
    String(row.id),
  );
  return true;
}

/**
 * Extract MCP token from Authorization header.
 * Accepts `Bearer <token>` and bare `<token>` (e.g. `Authorization: sntl_mcp_…`).
 * Never logs the value.
 */
export function extractMcpToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const v = authorization.trim();
  if (!v) return null;

  const bearer = /^Bearer\s+(\S+)/i.exec(v);
  if (bearer) return bearer[1];

  // Reject other auth schemes
  if (/^(Basic|Digest|Negotiate|Token)\s/i.test(v)) return null;

  // Bare token: first whitespace-separated field
  const bare = v.split(/\s+/)[0] ?? "";
  if (bare.startsWith(TOKEN_PREFIX)) return bare;
  return null;
}

/** @deprecated use extractMcpToken */
export function extractBearerToken(authorization: string | undefined): string | null {
  return extractMcpToken(authorization);
}
