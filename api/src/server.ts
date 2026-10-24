import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { addCounter, eventsByIds, hasFailedNotification, incidentById, latestEventTimestamp, listIncidentRecords, toIncident } from "./db.ts";
import { ingest } from "./ingest.ts";
import { ActionError, actionForIncident, approveAction, ensureActionsTable, rejectAction } from "./actions.ts";
import {
  createApiInvestigator,
  handleInvestigateRoute,
  healthLlmField,
  persistInvestigationResult,
} from "./investigate.ts";
import { isLlmProviderId } from "./llm-providers.ts";
import {
  publicLlmSettings,
  writeStoredLlmSettings,
  type LlmSettingsPatch,
} from "./llm-settings.ts";
import type { SendText } from "./notify.ts";
import { flushAndFollowUp } from "./pipeline.ts";
import { settingsOverview } from "./overview.ts";
import { AuthExistsError, createStoredAuth, hashPassword, identityFor, validateNewAccount, type DashboardIdentity } from "./dashboard-auth.ts";
import { clearAttempts, clearSessionCookie, hasValidSession, readSession, recordFailure, revokeSession, sessionCookie, tooManyAttempts } from "./session.ts";
import {
  addUserNotification,
  authenticate,
  createLinkCode,
  DuplicateUserError,
  ensureUserTables,
  findUserById,
  findUserByUsername,
  importFileUser,
  insertUser,
  listUserNotifications,
  type DashboardUser,
} from "./users.ts";
import type { Config, Incident, SentinelEvent } from "./types.ts";
import type { Investigator } from "./investigator/index.ts";
import { ValidationError } from "./validate.ts";
import { serveWeb } from "./web.ts";
import {
  handleMcpGet,
  handleMcpHttp,
  handleMcpOptions,
  sendMcpHttpResult,
} from "./mcp/http.ts";
import { ensureMcpTokensTable } from "./mcp/tokens.ts";

export interface ServerOptions {
  config: Config;
  db: DatabaseSync;
  send?: SendText;
  investigator?: Investigator;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function presentedBasic(req: IncomingMessage): { username: string; password: string } | null {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const split = decoded.indexOf(":");
  if (split < 0) return null;
  return { username: decoded.slice(0, split), password: decoded.slice(split + 1) };
}

function authorized(req: IncomingMessage, identity: DashboardIdentity | null, db: DatabaseSync): boolean {
  if (!identity) return false;
  const basic = presentedBasic(req);
  if (basic && authenticate(db, identity, basic.username, basic.password)) return true;
  return hasValidSession(req.headers.cookie, identity.sessionSecret);
}

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}

function readJsonObject(text: string): Record<string, unknown> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "body must be JSON");
  }
  if (!body || typeof body !== "object") throw new HttpError(400, "body must be an object");
  return body as Record<string, unknown>;
}

function establishSession(res: ServerResponse, identity: DashboardIdentity, userId: string): void {
  res.setHeader("set-cookie", sessionCookie(identity.sessionSecret, Date.now(), userId));
  res.setHeader("cache-control", "no-store");
  sendJson(res, 200, { ok: true });
}

function signedInUser(req: IncomingMessage, config: Config, db: DatabaseSync): DashboardUser | null {
  const identity = identityFor(config);
  if (!identity) return null;
  const basic = presentedBasic(req);
  if (basic) return authenticate(db, identity, basic.username, basic.password);
  const claims = readSession(req.headers.cookie, identity.sessionSecret);
  if (!claims?.userId) return findUserByUsername(db, identity.username);
  return findUserById(db, claims.userId);
}

async function handleLogin(req: IncomingMessage, res: ServerResponse, config: Config, db: DatabaseSync): Promise<void> {
  const identity = identityFor(config);
  if (!identity) throw new HttpError(401, "setup_required");
  const ip = clientIp(req);
  if (tooManyAttempts(ip)) throw new HttpError(429, "too many attempts");
  const body = readJsonObject(await readBody(req));
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  const user = username.length > 256 || password.length > 256 ? null : authenticate(db, identity, username, password);
  if (!user) {
    recordFailure(ip);
    throw new HttpError(401, "invalid credentials");
  }
  clearAttempts(ip);
  establishSession(res, identity, user.id);
}

async function handleSetup(req: IncomingMessage, res: ServerResponse, config: Config, db: DatabaseSync): Promise<void> {
  if (identityFor(config)) throw new HttpError(409, "already configured");
  if (!config.dashboardAuthPath) throw new HttpError(500, "dashboard auth path is not configured");
  const ip = clientIp(req);
  if (tooManyAttempts(ip)) throw new HttpError(429, "too many attempts");
  const body = readJsonObject(await readBody(req));
  const account = validateNewAccount(body.username, body.password);
  if (typeof account === "string") throw new HttpError(400, account);
  let stored;
  try {
    stored = createStoredAuth(config.dashboardAuthPath, account.username, account.password);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST" || err instanceof AuthExistsError) {
      throw new HttpError(409, "already configured");
    }
    throw err;
  }
  clearAttempts(ip);
  const user = insertUser(db, stored.username, stored.passwordHash);
  establishSession(res, {
    username: stored.username,
    sessionSecret: stored.sessionSecret,
    source: "file",
    passwordHash: stored.passwordHash,
    password: null,
  }, user.id);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 2_000_000) throw new HttpError(400, "body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handle(req: IncomingMessage, res: ServerResponse, options: ServerOptions): Promise<void> {
  const { config, db } = options;
  const investigator =
    options.investigator ?? createApiInvestigator(db, config.llmSettingsPath);
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  if (path === "/events") {
    if (req.method !== "POST") throw new HttpError(405, "method not allowed");
    if (!isLoopback(req.socket.remoteAddress)) throw new HttpError(403, "ingest is localhost only");
    const text = await readBody(req);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ValidationError("body must be JSON");
    }
    const result = ingest(db, body, config);
    await flushAndFollowUp(db, config, investigator, options.send);
    sendJson(res, 200, result);
    return;
  }

  // Remote MCP (Streamable HTTP): MCP token auth, not dashboard Basic/session. Before the dashboard gate.
  if (path === "/mcp") {
    if (req.method === "OPTIONS") {
      sendMcpHttpResult(res, handleMcpOptions());
      return;
    }
    if (req.method === "GET") {
      sendMcpHttpResult(res, handleMcpGet());
      return;
    }
    if (req.method !== "POST") throw new HttpError(405, "method not allowed");
    const text = await readBody(req);
    const result = await handleMcpHttp(req, text, db, config);
    sendMcpHttpResult(res, result);
    return;
  }

  if (path === "/auth/status" && req.method === "GET") {
    sendJson(res, 200, { configured: identityFor(config) !== null });
    return;
  }

  if (path === "/login" && req.method === "POST") {
    await handleLogin(req, res, config, db);
    return;
  }

  if (path === "/setup" && req.method === "POST") {
    await handleSetup(req, res, config, db);
    return;
  }

  if (path === "/logout" && req.method === "POST") {
    const identity = identityFor(config);
    if (identity) revokeSession(req.headers.cookie, identity.sessionSecret);
    res.setHeader("set-cookie", clearSessionCookie());
    res.setHeader("cache-control", "no-store");
    // 401 makes the browser drop cached basic-auth credentials for this origin.
    res.setHeader("www-authenticate", 'Basic realm="sentinel"');
    sendJson(res, 401, { ok: true });
    return;
  }

  // The SPA shell has no incidents or secrets. It has to load before sign-in,
  // otherwise the browser's native prompt replaces the dashboard login screen.
  if (config.webDist && (await serveWeb(req, res, config.webDist, path))) return;

  const identity = identityFor(config);
  if (!authorized(req, identity, db)) {
    if (!identity) throw new HttpError(401, "setup_required");
    throw new HttpError(401, "unauthorized");
  }

  if (path === "/health" && req.method === "GET") {
    sendJson(res, 200, {
      collector_last_event_at: latestEventTimestamp(db),
      llm: healthLlmField(investigator),
      telegram: config.telegramToken && config.telegramChatId && !hasFailedNotification(db) ? "ok" : "failed",
      db: "ok",
      host_id: config.hostId ?? null,
    });
    return;
  }

  if (path === "/incidents" && req.method === "GET") {
    sendJson(res, 200, listIncidentRecords(db).map((record) => withResponse(db, toIncident(record), eventsByIds(db, record.eventIds))));
    return;
  }

  if (path === "/notifications" && req.method === "GET") {
    const user = signedInUser(req, config, db);
    sendJson(res, 200, { notifications: user ? listUserNotifications(db, user.id) : [] });
    return;
  }

  if (path === "/notifications/link" && req.method === "POST") {
    const user = signedInUser(req, config, db);
    if (!user) throw new HttpError(401, "unauthorized");
    sendJson(res, 200, createLinkCode(db, user.id));
    return;
  }

  if (path === "/users" && req.method === "POST") {
    const user = signedInUser(req, config, db);
    if (!user) throw new HttpError(401, "unauthorized");
    const body = readJsonObject(await readBody(req));
    const account = validateNewAccount(body.username, body.password);
    if (typeof account === "string") throw new HttpError(400, account);
    try {
      insertUser(db, account.username, hashPassword(account.password));
    } catch (err) {
      if (err instanceof DuplicateUserError) throw new HttpError(409, "username is taken");
      throw err;
    }
    sendJson(res, 201, { username: account.username });
    return;
  }

  if (path === "/settings/overview" && req.method === "GET") {
    sendJson(res, 200, settingsOverview(db, config));
    return;
  }

  if (path === "/settings/llm") {
    if (req.method === "GET") {
      sendJson(res, 200, publicLlmSettings(config.llmSettingsPath));
      return;
    }
    if (req.method === "PUT") {
      const text = await readBody(req);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new ValidationError("body must be JSON");
      }
      if (!body || typeof body !== "object") throw new ValidationError("body must be an object");
      const o = body as Record<string, unknown>;
      const patch: LlmSettingsPatch = {};
      if ("apiKey" in o) {
        if (typeof o.apiKey !== "string") throw new ValidationError("apiKey must be a string");
        patch.apiKey = o.apiKey;
      }
      if ("baseUrl" in o) {
        if (typeof o.baseUrl !== "string") throw new ValidationError("baseUrl must be a string");
        patch.baseUrl = o.baseUrl;
      }
      if ("model" in o) {
        if (typeof o.model !== "string") throw new ValidationError("model must be a string");
        patch.model = o.model;
      }
      if ("activeProvider" in o) {
        if (!isLlmProviderId(o.activeProvider)) {
          throw new ValidationError("activeProvider must be openai|anthropic|gemini|openrouter|custom");
        }
        patch.activeProvider = o.activeProvider;
      }
      if ("provider" in o) {
        if (!isLlmProviderId(o.provider)) {
          throw new ValidationError("provider must be openai|anthropic|gemini|openrouter|custom");
        }
        patch.provider = o.provider;
      }
      if (
        !("apiKey" in patch) &&
        !("baseUrl" in patch) &&
        !("model" in patch) &&
        !("activeProvider" in patch)
      ) {
        throw new ValidationError("provide apiKey, baseUrl, model, and/or activeProvider");
      }
      writeStoredLlmSettings(config.llmSettingsPath, patch);
      sendJson(res, 200, publicLlmSettings(config.llmSettingsPath));
      return;
    }
    throw new HttpError(405, "method not allowed");
  }

  if (path.startsWith("/incidents/") && path.endsWith("/investigate") && req.method === "POST") {
    const id = path.slice("/incidents/".length, -"/investigate".length);
    if (!/^inc-\d+$/.test(id)) throw new HttpError(404, "not found");
    if (!incidentById(db, id)) throw new HttpError(404, "not found");
    const investigation = await handleInvestigateRoute(investigator, id, async (incidentId, inv) => {
      persistInvestigationResult(db, incidentId, inv);
    });
    const actor = signedInUser(req, config, db);
    if (actor) addUserNotification(db, actor.id, "investigation", id, `Your investigation of incident ${id} finished.`);
    sendJson(res, 200, investigation);
    return;
  }

  if (req.method === "GET" && path.startsWith("/incidents/")) {
    const id = path.slice("/incidents/".length);
    if (!/^inc-\d+$/.test(id)) throw new HttpError(404, "not found");
    const record = incidentById(db, id);
    if (!record) throw new HttpError(404, "not found");
    const events = eventsByIds(db, record.eventIds);
    sendJson(res, 200, { ...withResponse(db, toIncident(record), events), events });
    return;
  }

  const actionRoute = /^\/actions\/(act-\d+)\/(approve|reject)$/.exec(path);
  if (actionRoute && req.method === "POST") {
    const [, actionId, decision] = actionRoute as unknown as [string, string, "approve" | "reject"];
    if (!config.response) throw new HttpError(503, "response actions are not configured");
    const action = decision === "approve" ? await approveAction(db, actionId, config.response) : rejectAction(db, actionId);
    const actor = signedInUser(req, config, db);
    if (actor) {
      const row = db.prepare("SELECT incident_id FROM actions WHERE id = ?").get(actionId) as { incident_id?: string } | undefined;
      const incidentId = row?.incident_id ?? actionId;
      const sentence = decision === "approve"
        ? `You approved the response for incident ${incidentId}.`
        : `You rejected the response for incident ${incidentId}.`;
      addUserNotification(db, actor.id, decision, row?.incident_id ?? null, sentence);
    }
    sendJson(res, 200, action);
    return;
  }

  throw new HttpError(404, "not found");
}

function originOf(events: SentinelEvent[]): Incident["origin"] {
  const replay = events.filter((event) => event.origin === "replay").length;
  if (replay === 0) return "live";
  return replay === events.length ? "replay" : "mixed";
}

function withResponse(db: DatabaseSync, incident: Incident, events: SentinelEvent[]): Incident {
  return { ...incident, action: actionForIncident(db, incident.id), origin: originOf(events) };
}

export function createServer(options: ServerOptions): Server {
  ensureActionsTable(options.db);
  ensureMcpTokensTable(options.db);
  ensureUserTables(options.db);
  const stored = identityFor(options.config);
  if (stored?.passwordHash) importFileUser(options.db, stored.username, stored.passwordHash);
  const investigator =
    options.investigator ??
    createApiInvestigator(options.db, options.config.llmSettingsPath);
  const opts: ServerOptions = { ...options, investigator };
  return createHttpServer((req, res) => {
    void handle(req, res, opts).catch((err: unknown) => {
      if (res.headersSent) return;
      if (err instanceof ValidationError || (err instanceof HttpError && err.status === 400)) {
        const total = addCounter(options.db, "rejected_batches");
        console.warn(`rejected batch (${total}): ${err.message}`);
        sendJson(res, 400, { error: err.message });
        return;
      }
      if (err instanceof HttpError || err instanceof ActionError) {
        sendJson(res, err.status, { error: err.message });
        return;
      }
      console.error(err);
      sendJson(res, 500, { error: "internal error" });
    });
  });
}
