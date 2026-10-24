import { createHmac, timingSafeEqual } from "node:crypto";

// Dashboard session. The password never leaves the server: the cookie is an
// expiry plus an HMAC, HttpOnly, so page scripts cannot read it.
const COOKIE = "sentinel_session";
const TTL_SECONDS = 12 * 60 * 60;
const WINDOW_MS = 60_000;
const MAX_FAILURES = 8;

const failures = new Map<string, number[]>();
const revoked = new Set<string>();

function mac(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function issueSessionToken(secret: string, expSeconds: number): string {
  const body = String(expSeconds);
  return `${body}.${mac(secret, body)}`;
}

export function sessionCookie(secret: string, nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + TTL_SECONDS;
  return `${COOKIE}=${issueSessionToken(secret, exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function hasValidSession(cookieHeader: string | undefined, secret: string, nowMs = Date.now()): boolean {
  if (!secret) return false;
  const token = readCookie(cookieHeader, COOKIE);
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(body);
  if (!Number.isInteger(exp) || exp <= Math.floor(nowMs / 1000)) return false;
  const expected = mac(secret, body);
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  if (revoked.has(token)) return false;
  return timingSafeEqual(left, right);
}

export function revokeSession(cookieHeader: string | undefined, secret: string): void {
  if (!secret) return;
  const token = readCookie(cookieHeader, COOKIE);
  if (!token || !hasValidSession(cookieHeader, secret)) return;
  if (revoked.size >= 1000) revoked.clear();
  revoked.add(token);
}

export function tooManyAttempts(ip: string, nowMs = Date.now()): boolean {
  const recent = (failures.get(ip) ?? []).filter((at) => nowMs - at < WINDOW_MS);
  failures.set(ip, recent);
  return recent.length >= MAX_FAILURES;
}

export function recordFailure(ip: string, nowMs = Date.now()): void {
  const recent = (failures.get(ip) ?? []).filter((at) => nowMs - at < WINDOW_MS);
  recent.push(nowMs);
  failures.set(ip, recent);
}

export function clearAttempts(ip: string): void {
  failures.delete(ip);
}
