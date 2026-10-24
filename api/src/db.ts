import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Incident, Pattern, SentinelEvent, Severity } from "./types.ts";

export interface SourceKey {
  hostId: string;
  sourceIp: string | null;
  usernameKey: string | null;
}

export type PendingKind = "new" | "escalation";

export interface IncidentRecord {
  id: string;
  seq: number;
  hostId: string;
  sourceIp: string | null;
  usernameKey: string | null;
  usernames: string[];
  patterns: Pattern[];
  severity: Severity;
  status: string;
  firstSeen: string;
  lastSeen: string;
  eventIds: string[];
  failedAttempts: number;
  notificationStatus: "pending" | "sent" | "failed";
  notificationAttempts: number;
  notificationLastAttemptAt: string | null;
  notificationLastSentAt: string | null;
  escalationSent: boolean;
  pendingKind: PendingKind | null;
  nextSendAt: string | null;
  notifyClaimed: boolean;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  event_ts TEXT NOT NULL,
  type TEXT NOT NULL,
  username TEXT,
  source_ip TEXT,
  source_port INTEGER,
  raw_message TEXT NOT NULL,
  origin TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_source ON events (host_id, source_ip, event_ts);
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  host_id TEXT NOT NULL,
  source_ip TEXT,
  username_key TEXT,
  usernames TEXT NOT NULL,
  patterns TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  event_ids TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL,
  notification_status TEXT NOT NULL,
  notification_attempts INTEGER NOT NULL,
  notification_last_attempt_at TEXT,
  notification_last_sent_at TEXT,
  escalation_sent INTEGER NOT NULL DEFAULT 0,
  pending_kind TEXT,
  next_send_at TEXT,
  notify_claimed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`;

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 3000");
  if (dbPath !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  db.exec("UPDATE incidents SET notify_claimed = 0 WHERE notify_claimed = 1");
  return db;
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function insertIgnoreEvent(db: DatabaseSync, event: SentinelEvent): boolean {
  const result = db.prepare(`
    INSERT OR IGNORE INTO events (
      event_id, host_id, event_ts, type, username, source_ip, source_port, raw_message, origin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.event_id,
    event.host_id,
    event.timestamp,
    event.type,
    event.username,
    event.source_ip,
    event.source_port,
    event.raw_message,
    event.origin,
  );
  return Number(result.changes) === 1;
}

export function eventsForKey(db: DatabaseSync, key: SourceKey): SentinelEvent[] {
  const rows = key.sourceIp === null
    ? db.prepare(`
        SELECT * FROM events
        WHERE host_id = ? AND source_ip IS NULL AND ifnull(username, '') = ?
        ORDER BY event_ts, event_id
      `).all(key.hostId, key.usernameKey ?? "") as Row[]
    : db.prepare(`
        SELECT * FROM events
        WHERE host_id = ? AND source_ip = ?
        ORDER BY event_ts, event_id
      `).all(key.hostId, key.sourceIp) as Row[];
  return rows.map(mapEvent);
}

export function matchingEvents(
  db: DatabaseSync,
  filter: { sourceIp?: string; username?: string },
): SentinelEvent[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter.sourceIp !== undefined) {
    clauses.push("source_ip = ?");
    params.push(filter.sourceIp);
  }
  if (filter.username !== undefined) {
    clauses.push("ifnull(username, '') = ?");
    params.push(filter.username);
  }
  if (clauses.length === 0) return [];
  const rows = db.prepare(
    `SELECT * FROM events WHERE ${clauses.join(" AND ")} ORDER BY event_ts, event_id`,
  ).all(...params) as Row[];
  return rows.map(mapEvent);
}

export function eventsByIds(db: DatabaseSync, ids: string[]): SentinelEvent[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = db.prepare(`SELECT * FROM events WHERE event_id IN (${placeholders})`).all(...ids) as Row[];
  const byId = new Map(rows.map((row) => [String(row.event_id), mapEvent(row)]));
  return ids.flatMap((id) => {
    const event = byId.get(id);
    return event ? [event] : [];
  });
}

export function openIncidentForKey(db: DatabaseSync, key: SourceKey): IncidentRecord | null {
  const row = key.sourceIp === null
    ? db.prepare(`
        SELECT * FROM incidents
        WHERE host_id = ? AND status != 'closed' AND source_ip IS NULL AND username_key = ?
        ORDER BY seq DESC LIMIT 1
      `).get(key.hostId, key.usernameKey ?? "") as Row | undefined
    : db.prepare(`
        SELECT * FROM incidents
        WHERE host_id = ? AND status != 'closed' AND source_ip = ?
        ORDER BY seq DESC LIMIT 1
      `).get(key.hostId, key.sourceIp) as Row | undefined;
  return row ? mapIncident(row) : null;
}

export function nextIncidentSeq(db: DatabaseSync): number {
  const row = db.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM incidents").get() as Row;
  return Number(row.n) + 1;
}

export function insertIncident(db: DatabaseSync, record: IncidentRecord): void {
  db.prepare(`
    INSERT INTO incidents (
      id, seq, host_id, source_ip, username_key, usernames, patterns, severity, status,
      first_seen, last_seen, event_ids, failed_attempts, notification_status,
      notification_attempts, notification_last_attempt_at, notification_last_sent_at,
      escalation_sent, pending_kind, next_send_at, notify_claimed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.seq,
    record.hostId,
    record.sourceIp,
    record.usernameKey,
    JSON.stringify(record.usernames),
    JSON.stringify(record.patterns),
    record.severity,
    record.status,
    record.firstSeen,
    record.lastSeen,
    JSON.stringify(record.eventIds),
    record.failedAttempts,
    record.notificationStatus,
    record.notificationAttempts,
    record.notificationLastAttemptAt,
    record.notificationLastSentAt,
    record.escalationSent ? 1 : 0,
    record.pendingKind,
    record.nextSendAt,
    record.notifyClaimed ? 1 : 0,
  );
}

export function saveIncident(db: DatabaseSync, record: IncidentRecord): void {
  db.prepare(`
    UPDATE incidents SET
      usernames = ?, patterns = ?, severity = ?, status = ?, first_seen = ?, last_seen = ?,
      event_ids = ?, failed_attempts = ?, notification_status = ?, notification_attempts = ?,
      notification_last_attempt_at = ?, notification_last_sent_at = ?, escalation_sent = ?,
      pending_kind = ?, next_send_at = ?, notify_claimed = ?
    WHERE id = ?
  `).run(
    JSON.stringify(record.usernames),
    JSON.stringify(record.patterns),
    record.severity,
    record.status,
    record.firstSeen,
    record.lastSeen,
    JSON.stringify(record.eventIds),
    record.failedAttempts,
    record.notificationStatus,
    record.notificationAttempts,
    record.notificationLastAttemptAt,
    record.notificationLastSentAt,
    record.escalationSent ? 1 : 0,
    record.pendingKind,
    record.nextSendAt,
    record.notifyClaimed ? 1 : 0,
    record.id,
  );
}

export function listIncidentRecords(db: DatabaseSync): IncidentRecord[] {
  const rows = db.prepare("SELECT * FROM incidents ORDER BY seq DESC").all() as Row[];
  return rows.map(mapIncident);
}

export function incidentById(db: DatabaseSync, id: string): IncidentRecord | null {
  const row = db.prepare("SELECT * FROM incidents WHERE id = ?").get(id) as Row | undefined;
  return row ? mapIncident(row) : null;
}

export function listDueIncidents(db: DatabaseSync, nowIso: string): IncidentRecord[] {
  const rows = db.prepare(`
    SELECT * FROM incidents
    WHERE pending_kind IS NOT NULL
      AND notify_claimed = 0
      AND (next_send_at IS NULL OR next_send_at <= ?)
    ORDER BY seq ASC
  `).all(nowIso) as Row[];
  return rows.map(mapIncident);
}

export function claimNotification(db: DatabaseSync, id: string): boolean {
  const result = db.prepare(`
    UPDATE incidents SET notify_claimed = 1
    WHERE id = ? AND pending_kind IS NOT NULL AND notify_claimed = 0
  `).run(id);
  return Number(result.changes) === 1;
}

export function latestEventTimestamp(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT MAX(event_ts) AS ts FROM events").get() as Row;
  return text(row.ts);
}

export function hasFailedNotification(db: DatabaseSync): boolean {
  const row = db.prepare(`
    SELECT 1 AS n FROM incidents
    WHERE notification_status = 'failed' AND pending_kind IS NOT NULL
    LIMIT 1
  `).get() as Row | undefined;
  return row !== undefined;
}

export function addCounter(db: DatabaseSync, name: string): number {
  db.prepare(`
    INSERT INTO counters (name, value) VALUES (?, 1)
    ON CONFLICT(name) DO UPDATE SET value = value + 1
  `).run(name);
  const row = db.prepare("SELECT value FROM counters WHERE name = ?").get(name) as Row;
  return Number(row.value);
}

export function toIncident(record: IncidentRecord): Incident {
  return {
    id: record.id,
    host_id: record.hostId,
    source_ip: record.sourceIp,
    usernames: record.usernames,
    patterns: record.patterns,
    severity: record.severity,
    status: record.status,
    first_seen: record.firstSeen,
    last_seen: record.lastSeen,
    event_ids: record.eventIds,
    failed_attempts: record.failedAttempts,
    notification: {
      status: record.notificationStatus,
      attempts: record.notificationAttempts,
      last_attempt_at: record.notificationLastAttemptAt,
    },
    investigation: null,
    action: null,
  };
}

function mapEvent(row: Row): SentinelEvent {
  return {
    event_id: String(row.event_id),
    host_id: String(row.host_id),
    timestamp: String(row.event_ts),
    type: row.type as SentinelEvent["type"],
    username: text(row.username),
    source_ip: text(row.source_ip),
    source_port: row.source_port === null ? null : Number(row.source_port),
    raw_message: String(row.raw_message),
    origin: row.origin as SentinelEvent["origin"],
  };
}

function mapIncident(row: Row): IncidentRecord {
  return {
    id: String(row.id),
    seq: Number(row.seq),
    hostId: String(row.host_id),
    sourceIp: text(row.source_ip),
    usernameKey: text(row.username_key),
    usernames: JSON.parse(String(row.usernames)) as string[],
    patterns: JSON.parse(String(row.patterns)) as Pattern[],
    severity: row.severity as Severity,
    status: String(row.status),
    firstSeen: String(row.first_seen),
    lastSeen: String(row.last_seen),
    eventIds: JSON.parse(String(row.event_ids)) as string[],
    failedAttempts: Number(row.failed_attempts),
    notificationStatus: row.notification_status as IncidentRecord["notificationStatus"],
    notificationAttempts: Number(row.notification_attempts),
    notificationLastAttemptAt: text(row.notification_last_attempt_at),
    notificationLastSentAt: text(row.notification_last_sent_at),
    escalationSent: Number(row.escalation_sent) === 1,
    pendingKind: text(row.pending_kind) as PendingKind | null,
    nextSendAt: text(row.next_send_at),
    notifyClaimed: Number(row.notify_claimed) === 1,
  };
}
