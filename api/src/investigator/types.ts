/** Contract types Hugo needs; Kevin may later centralize in api/src/contract.ts */

export type EventType =
  | "ssh_invalid_user"
  | "ssh_preauth_disconnect"
  | "ssh_failed_password"
  | "ssh_success"
  | "ssh_flood"
  | "sudo_denied"
  | "user_created"
  | "cron_changed";

export interface SentinelEvent {
  event_id: string;
  host_id: string;
  timestamp: string;
  type: EventType;
  username: string | null;
  source_ip: string | null;
  source_port: number | null;
  raw_message: string;
  origin: "live" | "replay";
}

export type IncidentStatus =
  | "new"
  | "investigating"
  | "investigated"
  | "action_pending"
  | "action_applied"
  | "action_rejected"
  | "action_failed"
  | "closed";

export type Severity = "low" | "medium" | "high";

export interface Finding {
  kind: "observed" | "suspected" | "unknown";
  statement: string;
  evidence: string[];
}

export interface RootCause {
  kind: "observed" | "suspected" | "unknown";
  statement: string;
  evidence: string[];
}

export interface RemediationStep {
  order: number;
  text: string;
  urgency: Severity;
  mode: "manual" | "automatable";
  /** Only block_ip; target must equal incident.source_ip after validation. */
  action?: { kind: "block_ip"; target: string };
}

export interface Investigation {
  status: "ok" | "unavailable" | "failed";
  summary: string;
  findings: Finding[];
  recommendation: string;
  /** Present on new reports; optional for older investigation_json rows. */
  root_cause?: RootCause;
  remediation?: RemediationStep[];
  mitre: string[];
  model: string;
  duration_ms: number;
  created_at: string;
}

export interface Incident {
  id: string;
  host_id: string;
  source_ip: string | null;
  usernames: string[];
  patterns: string[];
  severity: Severity;
  status: IncidentStatus;
  first_seen: string;
  last_seen: string;
  event_ids: string[];
  failed_attempts: number;
  notification: {
    status: "pending" | "sent" | "failed";
    attempts: number;
    last_attempt_at: string | null;
  };
  investigation: Investigation | null;
  action: unknown | null;
}

export interface HostMetadata {
  host_id: string;
  os: string;
  ssh_password_auth: string;
  sentinel_note: string;
}

export type MaybePromise<T> = T | Promise<T>;

export interface AuthHistoryQuery {
  source_ip?: string;
  username?: string;
  since: string;
  until: string;
  limit: number;
}

export interface InvestigatorDeps {
  getIncident(id: string): MaybePromise<Incident | null>;
  getEventsByIds(ids: string[]): MaybePromise<SentinelEvent[]>;
  getAuthHistory(q: AuthHistoryQuery): MaybePromise<SentinelEvent[]>;
  getHostMetadata?(host_id: string): MaybePromise<HostMetadata | null>;
  now?(): Date;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutSeconds: number;
  configured: boolean;
  /** Injectable for tests */
  fetch?: typeof fetch;
}

export interface ModelOutput {
  summary: string;
  findings: Finding[];
  recommendation: string;
  root_cause?: RootCause;
  remediation?: RemediationStep[];
  mitre: string[];
}

export interface Investigator {
  investigate(incidentId: string): Promise<Investigation>;
  llmHealth(): "ok" | "down";
  startHealthProbe(): () => void;
}

export const FAILURE_EVENT_TYPES: ReadonlySet<EventType> = new Set([
  "ssh_invalid_user",
  "ssh_preauth_disconnect",
  "ssh_failed_password",
]);

export const MITRE_ALLOWLIST: ReadonlySet<string> = new Set([
  "T1110",
  "T1110.001",
  "T1110.003",
  "T1110.004",
  "T1078",
  "T1021.004",
]);
