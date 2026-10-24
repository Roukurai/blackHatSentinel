/**
 * CLI for MCP Bearer tokens.
 * Usage: node --experimental-strip-types api/src/mcp/token-cli.ts create|list|revoke ...
 */
import { loadConfig } from "../config.ts";
import { openDatabase } from "../db.ts";
import {
  createMcpToken,
  listMcpTokens,
  revokeMcpToken,
} from "./tokens.ts";

function usage(): never {
  console.error(`Usage:
  sentinell mcp token create --name <name> [--expires <ISO8601>]
  sentinell mcp token list
  sentinell mcp token revoke <id>

Plaintext token is printed once on create. Store it in the client; only a hash is kept in the DB.
Never put tokens in Telegram alerts or paste them into chat logs.`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  sub: string;
  name: string;
  expires: string | null;
  id: string;
} {
  const sub = argv[0] ?? "";
  let name = "";
  let expires: string | null = null;
  let id = "";
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name" && argv[i + 1]) {
      name = argv[++i];
    } else if (a === "--expires" && argv[i + 1]) {
      expires = argv[++i];
    } else if (!a.startsWith("-") && sub === "revoke" && !id) {
      id = a;
    } else if (a === "-h" || a === "--help") {
      usage();
    }
  }
  return { sub, name, expires, id };
}

function main(): void {
  const { sub, name, expires, id } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const db = openDatabase(config.dbPath);

  try {
    if (sub === "create") {
      if (!name) usage();
      if (expires && Number.isNaN(Date.parse(expires))) {
        console.error("invalid --expires ISO8601 timestamp");
        process.exit(1);
      }
      const { token, meta } = createMcpToken(db, name, { expiresAt: expires });
      console.log(`id:        ${meta.id}`);
      console.log(`name:      ${meta.name}`);
      console.log(`last4:     …${meta.last4}`);
      console.log(`created:   ${meta.created_at}`);
      if (meta.expires_at) console.log(`expires:   ${meta.expires_at}`);
      console.log("");
      console.log("token (copy now — shown once):");
      console.log(token);
      return;
    }

    if (sub === "list") {
      const tokens = listMcpTokens(db);
      if (tokens.length === 0) {
        console.log("(no tokens)");
        return;
      }
      for (const t of tokens) {
        const status = t.revoked_at
          ? `revoked@${t.revoked_at}`
          : t.expires_at && Date.parse(t.expires_at) <= Date.now()
            ? "expired"
            : "active";
        console.log(
          `${t.id}\t${t.name}\t…${t.last4}\t${status}\tcreated=${t.created_at}` +
            (t.last_used_at ? `\tlast_used=${t.last_used_at}` : ""),
        );
      }
      return;
    }

    if (sub === "revoke") {
      if (!id) usage();
      const ok = revokeMcpToken(db, id);
      if (!ok) {
        console.error(`token not found or already revoked: ${id}`);
        process.exit(1);
      }
      console.log(`revoked ${id}`);
      return;
    }

    usage();
  } finally {
    db.close();
  }
}

main();
