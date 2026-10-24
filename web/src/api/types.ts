// Mirrors docs/CONTRACT.md v1 (PROPOSED). Fields marked ASSUMED are not in the
// contract yet; they are optional so the UI degrades when the API omits them.

// §1 Event
export type EventType =
  | "ssh_invalid_user"
  | "ssh_preauth_disconnect"
  | "ssh_failed_password"
  | "ssh_success"
  // reserved (P2)
  | "ssh_flood"
  | "sudo_denied"
  | "user_created"
  | "cron_changed";

export type Origin = "live" | "replay";

export interface SentinelEvent {
  event_id: string;
  host_id: string;
  timestamp: string;
  type: EventType;
  username: string | null; // "" is valid. UNTRUSTED.
  source_ip: string | null;
  source_port: number | null;
  raw_message: string; // UNTRUSTED. Render as text only.
  origin: Origin;
}

// §4 Incident
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

export type PatternLabel =
  | "burst"
  | "low_and_slow"
  | "success_after_failures"
  | "new_source_success"
  | "spray"
  | "privileged_target";

export type NotificationStatus = "pending" | "sent" | "failed";

export interface Notification {
  status: NotificationStatus;
  attempts: number;
  last_attempt_at: string | null;
}

export interface Incident {
  id: string;
  host_id: string;
  source_ip: string | null;
  usernames: string[]; // UNTRUSTED
  patterns: string[]; // PatternLabel, but unknown labels must still render
  severity: Severity;
  status: IncidentStatus;
  first_seen: string;
  last_seen: string;
  event_ids: string[];
  failed_attempts: number;
  notification: Notification;
  investigation: Investigation | null;
  action: ResponseAction | null;
  origin?: Origin | "mixed"; // ASSUMED (asked Kevin)
}

// ASSUMED shape of GET /incidents/:id ("Detail incl. events").
export interface IncidentDetail extends Incident {
  events?: SentinelEvent[];
}

// §5 Investigation
export type FindingKind = "observed" | "suspected" | "unknown";

export interface Finding {
  kind: FindingKind;
  statement: string;
  evidence: string[];
}

export type InvestigationStatus = "ok" | "unavailable" | "failed";

export interface Investigation {
  status: InvestigationStatus;
  summary: string;
  findings: Finding[];
  recommendation: string;
  mitre: string[];
  model: string;
  duration_ms: number;
  created_at: string;
}

// §8 Response (P1)
export type ActionStatus =
  | "proposed"
  | "rejected_by_policy"
  | "approved"
  | "applied"
  | "verified"
  | "expired"
  | "rolled_back"
  | "failed";

export interface ResponseAction {
  id: string;
  kind: "block_ip";
  target: string;
  ttl_seconds: number;
  status: ActionStatus;
  policy_reason: string | null;
  applied_at: string | null;
  expires_at: string | null;
}

// §6 Health
export interface Health {
  collector_last_event_at: string | null;
  llm: "ok" | "down";
  telegram: "ok" | "failed";
  db: "ok" | string;
  host_id?: string; // ASSUMED (asked Kevin)
}

export type LlmProviderId = "openai" | "anthropic" | "gemini" | "openrouter" | "custom";

export interface LlmProviderSlot {
  id: LlmProviderId;
  label: string;
  configured: boolean;
  baseUrl: string;
  model: string;
  keyLast4: string | null;
  keyPlaceholder: string;
  modelPlaceholder: string;
  baseUrlPlaceholder: string;
  hint: string;
}

/** GET/PUT /settings/llm — never includes the full API key. */
export interface LlmSettings {
  configured: boolean;
  activeProvider: LlmProviderId;
  baseUrl: string;
  model: string;
  keyLast4: string | null;
  updatedAt: string | null;
  source: "settings" | "env" | "none";
  providers: LlmProviderSlot[];
}

export interface LlmSettingsUpdate {
  activeProvider?: LlmProviderId;
  /** Slot to write into (defaults to activeProvider). */
  provider?: LlmProviderId;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}
