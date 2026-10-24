import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { hashPassword, verifyPassword } from "./dashboard-auth.ts";
import type { DashboardIdentity } from "./dashboard-auth.ts";
import { credentialsMatch } from "./dashboard-auth.ts";

// One row per person. A notification is addressed to that person and is never
// copied onto another account.

export interface DashboardUser {
  id: string;
  username: string;
  passwordHash: string;
  telegramChatId: string | null;
}

export interface UserNotification {
  id: string;
  kind: string;
  incident_id: string | null;
  body: string;
  created_at: string;
}

export class DuplicateUserError extends Error {
  constructor() {
    super("username is taken");
    this.name = "DuplicateUserError";
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS dashboard_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  telegram_chat_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  incident_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);
CREATE TABLE IF NOT EXISTS telegram_link_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`;

export function ensureUserTables(db: DatabaseSync): void {
  db.exec(SCHEMA);
}

function mapUser(row: Record<string, unknown>): DashboardUser {
  return {
    id: String(row.id),
    username: String(row.username),
    passwordHash: String(row.password_hash),
    telegramChatId: row.telegram_chat_id == null ? null : String(row.telegram_chat_id),
  };
}

export function findUserByUsername(db: DatabaseSync, username: string): DashboardUser | null {
  const row = db.prepare("SELECT * FROM dashboard_users WHERE username = ? COLLATE NOCASE").get(username) as Record<string, unknown> | undefined;
  return row ? mapUser(row) : null;
}

export function findUserById(db: DatabaseSync, id: string): DashboardUser | null {
  const row = db.prepare("SELECT * FROM dashboard_users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapUser(row) : null;
}

export function insertUser(db: DatabaseSync, username: string, passwordHash: string): DashboardUser {
  const user: DashboardUser = {
    id: `usr-${randomBytes(4).toString("hex")}`,
    username,
    passwordHash,
    telegramChatId: null,
  };
  try {
    db.prepare(
      "INSERT INTO dashboard_users (id, username, password_hash, telegram_chat_id, created_at) VALUES (?, ?, ?, NULL, ?)",
    ).run(user.id, user.username, user.passwordHash, new Date().toISOString());
  } catch (err) {
    if (String(err).includes("UNIQUE")) throw new DuplicateUserError();
    throw err;
  }
  return user;
}

export function importFileUser(db: DatabaseSync, username: string, passwordHash: string): void {
  if (findUserByUsername(db, username)) return;
  insertUser(db, username, passwordHash);
}

function updatePasswordHash(db: DatabaseSync, id: string, passwordHash: string): void {
  db.prepare("UPDATE dashboard_users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
}

export function authenticate(
  db: DatabaseSync,
  identity: DashboardIdentity | null,
  username: string,
  password: string,
): DashboardUser | null {
  const existing = findUserByUsername(db, username);
  // The host identity (dashboard-auth.json or DASHBOARD_USER/PASS) is authoritative for its
  // own username: after a password change the old stored hash must stop working at once.
  const isIdentityUser = identity !== null && username.toLowerCase() === identity.username.toLowerCase();
  if (existing && isIdentityUser) {
    if (!credentialsMatch(identity, identity.username, password)) return null;
    if (identity.passwordHash ? existing.passwordHash !== identity.passwordHash : !verifyPassword(password, existing.passwordHash)) {
      const hash = identity.passwordHash ?? hashPassword(password);
      updatePasswordHash(db, existing.id, hash);
      return { ...existing, passwordHash: hash };
    }
    return existing;
  }
  if (existing) {
    if (verifyPassword(password, existing.passwordHash)) return existing;
    if (identity && credentialsMatch(identity, username, password)) {
      const hash = identity.passwordHash ?? hashPassword(password);
      updatePasswordHash(db, existing.id, hash);
      return { ...existing, passwordHash: hash };
    }
    return null;
  }
  if (!identity || !credentialsMatch(identity, username, password)) return null;
  return insertUser(db, identity.username, identity.passwordHash ?? hashPassword(password));
}

export function addUserNotification(
  db: DatabaseSync,
  userId: string,
  kind: string,
  incidentId: string | null,
  body: string,
): void {
  const clean = body.replace(/[\r\n]/g, " ").slice(0, 400);
  db.prepare(
    "INSERT INTO user_notifications (id, user_id, kind, incident_id, body, created_at, delivered_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
  ).run(`ntf-${randomBytes(4).toString("hex")}`, userId, kind, incidentId, clean, new Date().toISOString());
}

export function listUserNotifications(db: DatabaseSync, userId: string): UserNotification[] {
  const rows = db.prepare(
    "SELECT id, kind, incident_id, body, created_at FROM user_notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50",
  ).all(userId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    incident_id: row.incident_id == null ? null : String(row.incident_id),
    body: String(row.body),
    created_at: String(row.created_at),
  }));
}

export function createLinkCode(db: DatabaseSync, userId: string): { code: string; expires_at: string } {
  const expires = new Date(Date.now() + 15 * 60_000).toISOString();
  const code = randomBytes(4).toString("hex").toUpperCase();
  db.prepare("DELETE FROM telegram_link_codes WHERE user_id = ? OR expires_at <= ?").run(userId, new Date().toISOString());
  db.prepare("INSERT INTO telegram_link_codes (code, user_id, expires_at) VALUES (?, ?, ?)").run(code, userId, expires);
  return { code, expires_at: expires };
}

export function tryBindTelegram(db: DatabaseSync, text: string, chatId: string): boolean {
  const raw = text.trim().slice(0, 64);
  const match = raw.match(/^(?:\/start(?:@[A-Za-z0-9_]+)?\s+)?([A-Za-z0-9]{6,16})$/);
  if (!match?.[1]) return false;
  const code = match[1].toUpperCase();
  const row = db.prepare("SELECT user_id, expires_at FROM telegram_link_codes WHERE code = ?").get(code) as
    | { user_id: string; expires_at: string }
    | undefined;
  if (!row) return false;
  if (Date.parse(row.expires_at) <= Date.now()) {
    db.prepare("DELETE FROM telegram_link_codes WHERE code = ?").run(code);
    return false;
  }
  db.prepare("UPDATE dashboard_users SET telegram_chat_id = NULL WHERE telegram_chat_id = ? AND id != ?").run(chatId, row.user_id);
  db.prepare("UPDATE dashboard_users SET telegram_chat_id = ? WHERE id = ?").run(chatId, row.user_id);
  db.prepare("DELETE FROM telegram_link_codes WHERE code = ?").run(code);
  addUserNotification(db, row.user_id, "telegram", null, "Your Telegram is linked to this account.");
  return true;
}

export interface PendingPersonal {
  id: string;
  body: string;
  chatId: string;
}

export function pendingPersonal(db: DatabaseSync): PendingPersonal[] {
  const rows = db.prepare(`
    SELECT n.id, n.body, u.telegram_chat_id
    FROM user_notifications n
    JOIN dashboard_users u ON u.id = n.user_id
    WHERE n.delivered_at IS NULL AND u.telegram_chat_id IS NOT NULL
  `).all() as Array<{ id: string; body: string; telegram_chat_id: string }>;
  return rows.map((row) => ({ id: row.id, body: row.body, chatId: row.telegram_chat_id }));
}

export function markPersonalDelivered(db: DatabaseSync, id: string): void {
  db.prepare("UPDATE user_notifications SET delivered_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}
