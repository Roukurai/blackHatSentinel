import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// The password chosen on first launch. The file holds a hash and a session
// secret, never the password. Env DASHBOARD_USER / DASHBOARD_PASS still work
// when this file does not exist.

export interface StoredDashboardAuth {
  username: string;
  passwordHash: string;
  sessionSecret: string;
  createdAt: string;
}

export interface DashboardIdentity {
  username: string;
  sessionSecret: string;
  source: "file" | "env";
  passwordHash: string | null;
  password: string | null;
}

export function authPathForDb(dbPath: string): string {
  if (dbPath === ":memory:") return "";
  return path.join(path.dirname(dbPath), "dashboard-auth.json");
}

export function envSessionSecret(user: string, pass: string): string {
  return createHash("sha256").update(`${user}\0${pass}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, saltB64, hashB64] = stored.split(":");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(hashB64, "base64url");
  const actual = scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

const USER_RE = /^[A-Za-z0-9._@+-]{1,64}$/;

export function validateNewAccount(username: unknown, password: unknown): { username: string; password: string } | string {
  if (typeof username !== "string" || !USER_RE.test(username)) {
    return "username must be 1–64 letters, numbers, or . _ @ + -";
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 256) {
    return "password must be at least 8 characters";
  }
  return { username, password };
}

export function readStoredAuth(filePath: string): StoredDashboardAuth | null {
  if (!filePath) return null;
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const parsed = JSON.parse(text) as StoredDashboardAuth;
  if (!parsed || typeof parsed.username !== "string" || typeof parsed.passwordHash !== "string" || typeof parsed.sessionSecret !== "string") {
    throw new Error("dashboard auth file is unreadable");
  }
  return parsed;
}

export class AuthExistsError extends Error {
  constructor() {
    super("already configured");
    this.name = "AuthExistsError";
  }
}

export function createStoredAuth(filePath: string, username: string, password: string): StoredDashboardAuth {
  const record: StoredDashboardAuth = {
    username,
    passwordHash: hashPassword(password),
    sessionSecret: randomBytes(32).toString("base64url"),
    createdAt: new Date().toISOString(),
  };
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(record)}\n`, { flag: "wx", mode: 0o600 });
  return record;
}

export function identityFor(config: {
  dashboardAuthPath?: string;
  dashboardUser: string;
  dashboardPass: string;
}): DashboardIdentity | null {
  if (config.dashboardAuthPath) {
    const stored = readStoredAuth(config.dashboardAuthPath);
    if (stored) {
      return {
        username: stored.username,
        sessionSecret: stored.sessionSecret,
        source: "file",
        passwordHash: stored.passwordHash,
        password: null,
      };
    }
  }
  if (config.dashboardUser && config.dashboardPass) {
    return {
      username: config.dashboardUser,
      sessionSecret: envSessionSecret(config.dashboardUser, config.dashboardPass),
      source: "env",
      passwordHash: null,
      password: config.dashboardPass,
    };
  }
  return null;
}

export function credentialsMatch(identity: DashboardIdentity, username: string, password: string): boolean {
  const userOk = safeEqual(username, identity.username);
  const passOk = identity.passwordHash
    ? verifyPassword(password, identity.passwordHash)
    : safeEqual(password, identity.password ?? "");
  return userOk && passOk;
}
