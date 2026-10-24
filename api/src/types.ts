export const EVENT_TYPES = [
  "ssh_invalid_user",
  "ssh_preauth_disconnect",
  "ssh_failed_password",
  "ssh_success",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const FAILURE_TYPES = [
  "ssh_invalid_user",
  "ssh_preauth_disconnect",
  "ssh_failed_password",
] as const;

export type Origin = "live" | "replay";

export interface SentinelEvent {
  event_id: string;
  host_id: string;
  timestamp: string;
  type: EventType;
  username: string | null;
  source_ip: string | null;
  source_port: number | null;
  raw_message: string;
  origin: Origin;
}

export type Severity = "low" | "medium" | "high";

export type Pattern =
  | "burst"
  | "low_and_slow"
  | "success_after_failures"
  | "new_source_success";

export interface Incident {
  id: string;
  host_id: string;
  source_ip: string | null;
  usernames: string[];
  patterns: Pattern[];
  severity: Severity;
  status: string;
  first_seen: string;
  last_seen: string;
  event_ids: string[];
  failed_attempts: number;
  notification: {
    status: "pending" | "sent" | "failed";
    attempts: number;
    last_attempt_at: string | null;
  };
  investigation: null;
  action: null;
}

export interface DetectConfig {
  fastCount: number;
  fastWindowMs: number;
  slowCount: number;
  slowWindowMs: number;
}

export interface Config {
  bind: string;
  port: number;
  publicBaseUrl: string;
  dbPath: string;
  dashboardUser: string;
  dashboardPass: string;
  telegramToken: string;
  telegramChatId: string;
  notifyCooldownSeconds: number;
  detect: DetectConfig;
  llmBaseUrl: string;
}
