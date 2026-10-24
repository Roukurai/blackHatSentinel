import { execFile } from "node:child_process";
import { BlockList, isIP } from "node:net";
import { networkInterfaces } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { incidentById } from "./db.ts";
import type { ResponseAction, ResponseConfig } from "./types.ts";

// P1 response: a temporary, human-approved IP block. Policy is checked at proposal
// and again at approval; approval never bypasses the allowlist. The runner is a
// separate fixed-command helper (ops/sentinel-block) invoked with execFile, never a shell.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  ttl_seconds INTEGER NOT NULL,
  status TEXT NOT NULL,
  policy_reason TEXT,
  applied_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL
);
`;

const RUNNER_TIMEOUT_MS = 10_000;

export class ActionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ActionError";
    this.status = status;
  }
}

type Row = Record<string, unknown>;

export function ensureActionsTable(db: DatabaseSync): void {
  db.exec(SCHEMA);
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function mapAction(row: Row, now = Date.now()): ResponseAction {
  let status = String(row.status) as ResponseAction["status"];
  const expiresAt = text(row.expires_at);
  if ((status === "applied" || status === "verified") && expiresAt && Date.parse(expiresAt) <= now) status = "expired";
  return {
    id: String(row.id),
    kind: "block_ip",
    target: String(row.target),
    ttl_seconds: Number(row.ttl_seconds),
    status,
    policy_reason: text(row.policy_reason),
    applied_at: text(row.applied_at),
    expires_at: expiresAt,
  };
}

export function actionForIncident(db: DatabaseSync, incidentId: string): ResponseAction | null {
  const row = db.prepare("SELECT * FROM actions WHERE incident_id = ?").get(incidentId) as Row | undefined;
  return row ? mapAction(row) : null;
}

function actionRow(db: DatabaseSync, actionId: string): Row | null {
  return (db.prepare("SELECT * FROM actions WHERE id = ?").get(actionId) as Row | undefined) ?? null;
}

function updateAction(db: DatabaseSync, id: string, fields: Partial<Record<"status" | "policy_reason" | "applied_at" | "expires_at", string | null>>): void {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (keys.length === 0) return;
  db.prepare(`UPDATE actions SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => fields[k] ?? null), id);
}

function setIncidentStatus(db: DatabaseSync, incidentId: string, status: string): void {
  db.prepare("UPDATE incidents SET status = ? WHERE id = ?").run(status, incidentId);
}

function protectedList(allowlist: string[]): BlockList {
  const list = new BlockList();
  for (const entry of allowlist) {
    const [address, prefix] = entry.split("/");
    const family = isIP(address ?? "");
    if (!address || family === 0) continue;
    const type = family === 6 ? "ipv6" : "ipv4";
    if (prefix === undefined) list.addAddress(address, type);
    else list.addSubnet(address, Number(prefix), type);
  }
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) list.addAddress(addr.address, addr.family === "IPv6" ? "ipv6" : "ipv4");
  }
  list.addSubnet("127.0.0.0", 8, "ipv4");
  list.addAddress("::1", "ipv6");
  return list;
}

/** Returns a reason when blocking `ip` is not allowed, otherwise null. */
export function policyViolation(ip: string, response: ResponseConfig): string | null {
  const family = isIP(ip);
  if (family === 0) return "target is not a valid IP address";
  if (protectedList(response.allowlist).check(ip, family === 6 ? "ipv6" : "ipv4")) {
    return "target is protected (RESPONSE_ALLOWLIST or this host's own address)";
  }
  return null;
}

/** Propose a block for incidents worth containing. Idempotent per incident. */
export function proposeAction(db: DatabaseSync, incidentId: string, response: ResponseConfig, now = new Date()): ResponseAction | null {
  const existing = actionForIncident(db, incidentId);
  if (existing) return existing;
  const incident = incidentById(db, incidentId);
  if (!incident || !incident.sourceIp) return null;
  if (incident.severity !== "high" && incident.severity !== "medium") return null;

  const reason = policyViolation(incident.sourceIp, response);
  const id = `act-${incident.id.slice("inc-".length)}`;
  db.prepare(`
    INSERT INTO actions (id, incident_id, kind, target, ttl_seconds, status, policy_reason, created_at)
    VALUES (?, ?, 'block_ip', ?, ?, ?, ?, ?)
  `).run(id, incident.id, incident.sourceIp, response.ttlSeconds, reason ? "rejected_by_policy" : "proposed", reason, now.toISOString());
  return actionForIncident(db, incidentId);
}

function runRunner(response: ResponseConfig, args: string[]): Promise<{ ok: boolean; output: string }> {
  const file = response.runnerSudo ? "sudo" : response.runner;
  const argv = response.runnerSudo ? ["-n", response.runner, ...args] : args;
  return new Promise((resolve) => {
    execFile(file, argv, { timeout: RUNNER_TIMEOUT_MS }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: `${stdout}${stderr}`.trim().slice(0, 200) });
    });
  });
}

function pendingRow(db: DatabaseSync, actionId: string): Row {
  const row = actionRow(db, actionId);
  if (!row) throw new ActionError(404, "not found");
  const incident = incidentById(db, String(row.incident_id));
  if (!incident) throw new ActionError(404, "not found");
  if (incident.status === "action_rejected") throw new ActionError(409, "action was already rejected");
  if (row.status !== "proposed") throw new ActionError(409, `action is ${String(row.status)}, not proposed`);
  return row;
}

export async function approveAction(db: DatabaseSync, actionId: string, response: ResponseConfig, now = new Date()): Promise<ResponseAction> {
  const row = pendingRow(db, actionId);
  const incidentId = String(row.incident_id);
  const target = String(row.target);
  const ttl = Number(row.ttl_seconds);

  const reason = policyViolation(target, response);
  if (reason) {
    updateAction(db, actionId, { status: "rejected_by_policy", policy_reason: reason });
    throw new ActionError(403, reason);
  }

  updateAction(db, actionId, { status: "approved" });
  if (!response.runner) {
    updateAction(db, actionId, { status: "failed", policy_reason: "response runner not configured (RESPONSE_RUNNER)" });
    setIncidentStatus(db, incidentId, "action_failed");
    return mapAction(actionRow(db, actionId)!);
  }

  const blocked = await runRunner(response, ["block", target, String(ttl)]);
  if (!blocked.ok) {
    updateAction(db, actionId, { status: "failed", policy_reason: `runner failed: ${blocked.output || "no output"}` });
    setIncidentStatus(db, incidentId, "action_failed");
    return mapAction(actionRow(db, actionId)!);
  }

  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
  updateAction(db, actionId, { status: "applied", applied_at: now.toISOString(), expires_at: expiresAt });
  setIncidentStatus(db, incidentId, "action_applied");

  const verified = await runRunner(response, ["verify", target]);
  if (verified.ok) updateAction(db, actionId, { status: "verified" });
  return mapAction(actionRow(db, actionId)!);
}

export function rejectAction(db: DatabaseSync, actionId: string): ResponseAction {
  const row = pendingRow(db, actionId);
  setIncidentStatus(db, String(row.incident_id), "action_rejected");
  return mapAction(actionRow(db, actionId)!);
}
