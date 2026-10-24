import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./types.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function readEnvFile(filePath: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const comment = value.indexOf(" #");
    if (comment !== -1) value = value.slice(0, comment).trim();
    out[key] = value;
  }
  return out;
}

function pick(file: Record<string, string>, env: NodeJS.ProcessEnv, key: string, fallback = ""): string {
  const fromEnv = env[key];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  return file[key] ?? fallback;
}

function integer(value: string, fallback: number): number {
  if (value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const file = readEnvFile(path.join(repoRoot, ".env"));
  // Expose .env keys to process.env for the investigator (LLM_*), without overriding real env.
  for (const [key, value] of Object.entries(file)) {
    if (env[key] === undefined || env[key] === "") env[key] = value;
  }
  const port = integer(pick(file, env, "API_PORT", "8080"), 8080);
  const dbValue = pick(file, env, "DB_PATH", "./data/sentinel.db");
  const dbPath = path.isAbsolute(dbValue) ? dbValue : path.resolve(repoRoot, dbValue);
  return {
    bind: pick(file, env, "API_BIND", "127.0.0.1"),
    port,
    publicBaseUrl: pick(file, env, "PUBLIC_BASE_URL", `http://127.0.0.1:${port}`),
    dbPath,
    dashboardUser: pick(file, env, "DASHBOARD_USER"),
    dashboardPass: pick(file, env, "DASHBOARD_PASS"),
    telegramToken: pick(file, env, "TELEGRAM_BOT_TOKEN"),
    telegramChatId: pick(file, env, "TELEGRAM_CHAT_ID"),
    notifyCooldownSeconds: integer(pick(file, env, "NOTIFY_COOLDOWN_SECONDS", "300"), 300),
    detect: {
      fastCount: integer(pick(file, env, "DETECT_FAST_COUNT", "5"), 5),
      fastWindowMs: integer(pick(file, env, "DETECT_FAST_WINDOW_SECONDS", "120"), 120) * 1000,
      slowCount: integer(pick(file, env, "DETECT_SLOW_COUNT", "10"), 10),
      slowWindowMs: integer(pick(file, env, "DETECT_SLOW_WINDOW_SECONDS", "1800"), 1800) * 1000,
    },
    llmBaseUrl: pick(file, env, "LLM_BASE_URL"),
    hostId: pick(file, env, "HOST_ID", "ubuntu-01"),
    webDist: path.resolve(repoRoot, pick(file, env, "WEB_DIST", "web/dist")),
    response: {
      allowlist: pick(file, env, "RESPONSE_ALLOWLIST")
        .split(",")
        .map((cidr) => cidr.trim())
        .filter(Boolean),
      ttlSeconds: integer(pick(file, env, "RESPONSE_BLOCK_TTL_SECONDS", "600"), 600),
      runner: pick(file, env, "RESPONSE_RUNNER"),
      runnerSudo: pick(file, env, "RESPONSE_RUNNER_SUDO") === "1",
    },
  };
}
