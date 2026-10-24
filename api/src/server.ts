import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
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
import type { Config, Incident, SentinelEvent } from "./types.ts";
import type { Investigator } from "./investigator/index.ts";
import { ValidationError } from "./validate.ts";
import { serveWeb } from "./web.ts";

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

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function authorized(req: IncomingMessage, config: Config): boolean {
  if (!config.dashboardUser || !config.dashboardPass) return isLoopback(req.socket.remoteAddress);
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const split = decoded.indexOf(":");
  if (split < 0) return false;
  return safeEqual(decoded.slice(0, split), config.dashboardUser)
    && safeEqual(decoded.slice(split + 1), config.dashboardPass);
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

  if (!authorized(req, config)) {
    res.setHeader("www-authenticate", 'Basic realm="sentinel"');
    throw new HttpError(401, "unauthorized");
  }

  if (config.webDist && (await serveWeb(req, res, config.webDist, path))) return;

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
