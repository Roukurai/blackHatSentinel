import { EVENT_TYPES, type SentinelEvent } from "./types.ts";

const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);
const ID_RE = /^[a-f0-9]{64}$/;
const HOST_RE = /^[A-Za-z0-9._-]{1,64}$/;
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function isIp(value: string): boolean {
  if (value.length === 0 || value.length > 45) return false;
  if (value.includes(":")) return /^[0-9a-fA-F:.]+$/.test(value);
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function asObject(value: unknown, index: number): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`events[${index}] must be an object`);
  }
  return value as Record<string, unknown>;
}

export function validateBatch(body: unknown): SentinelEvent[] {
  if (!Array.isArray(body)) throw new ValidationError("body must be a JSON array");
  if (body.length < 1 || body.length > 500) {
    throw new ValidationError("batch must contain 1 to 500 events");
  }
  return body.map((item, index) => validateEvent(asObject(item, index), index));
}

function validateEvent(raw: Record<string, unknown>, index: number): SentinelEvent {
  const at = `events[${index}]`;
  if (typeof raw.event_id !== "string" || !ID_RE.test(raw.event_id)) {
    throw new ValidationError(`${at}.event_id must be a sha256 hex string`);
  }
  if (typeof raw.host_id !== "string" || !HOST_RE.test(raw.host_id)) {
    throw new ValidationError(`${at}.host_id must be 1-64 hostname characters`);
  }
  if (typeof raw.timestamp !== "string" || !TIME_RE.test(raw.timestamp) || Number.isNaN(Date.parse(raw.timestamp))) {
    throw new ValidationError(`${at}.timestamp must be ISO-8601 UTC`);
  }
  if (typeof raw.type !== "string" || !EVENT_TYPE_SET.has(raw.type)) {
    throw new ValidationError(`${at}.type is not a supported event type`);
  }
  if (raw.username !== null && typeof raw.username !== "string") {
    throw new ValidationError(`${at}.username must be a string or null`);
  }
  if (raw.source_ip !== null && (typeof raw.source_ip !== "string" || !isIp(raw.source_ip))) {
    throw new ValidationError(`${at}.source_ip must be an IP address or null`);
  }
  if (raw.source_port !== null) {
    if (typeof raw.source_port !== "number" || !Number.isInteger(raw.source_port) || raw.source_port < 0 || raw.source_port > 65535) {
      throw new ValidationError(`${at}.source_port must be an integer port or null`);
    }
  }
  if (typeof raw.raw_message !== "string") {
    throw new ValidationError(`${at}.raw_message must be a string`);
  }
  if (raw.origin !== "live" && raw.origin !== "replay") {
    throw new ValidationError(`${at}.origin must be live or replay`);
  }
  const username = raw.username === null ? null : raw.username.slice(0, 64);
  return {
    event_id: raw.event_id,
    host_id: raw.host_id,
    timestamp: raw.timestamp,
    type: raw.type as SentinelEvent["type"],
    username,
    source_ip: raw.source_ip,
    source_port: raw.source_port,
    raw_message: raw.raw_message,
    origin: raw.origin,
  };
}
