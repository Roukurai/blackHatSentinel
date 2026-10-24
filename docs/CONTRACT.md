# Sentinel interface contract — v1 (PROPOSED)

Status: **proposed at 10:15, confirm at team sync.** Items marked ⚖️ need explicit agreement.
After confirmation, changes require agreement from every affected owner.

---

## 1. Event (collector → API)

```ts
type EventType =
  // implemented (P0)
  | "ssh_invalid_user"        // Invalid user <name> from <ip> port <port>
  | "ssh_preauth_disconnect"  // Connection closed by authenticating user <name> <ip> port <port> [preauth]
  | "ssh_failed_password"     // Failed password for [invalid user ]<name> from <ip> port <port> ssh2
  | "ssh_success"             // Accepted <method> for <name> from <ip> port <port> ssh2[: <keytype> <fingerprint>]
  // reserved (P2, do not emit until agreed)
  | "ssh_flood"               // beginning MaxStartups throttling | drop connection #N from [<ip>]:<port> ... past MaxStartups
  | "sudo_denied"             // <user> : user NOT in sudoers | <n> incorrect password attempts
  | "user_created"            // useradd[...]: new user: name=<name>
  | "cron_changed";           // crontab REPLACE / BEGIN EDIT for <user>

interface SentinelEvent {
  event_id: string;            // sha256(journal __CURSOR), hex. Stable across re-reads and replay.
  host_id: string;             // from collector config (HOST_ID). Never parsed from the log line.
  timestamp: string;           // ISO-8601 UTC with ms, from __REALTIME_TIMESTAMP. e.g. "2026-10-24T15:51:15.123Z"
  type: EventType;
  username: string | null;     // null if not present. "" is VALID (real data contains empty usernames).
  source_ip: string | null;    // IPv4 or IPv6. null for local events (sudo/useradd/cron).
  source_port: number | null;  // ⚖️ added: lets correlation count distinct connection attempts exactly
  raw_message: string;         // journal MESSAGE verbatim. UNTRUSTED. Never shown in alerts.
  origin: "live" | "replay";   // ⚖️ added: the plan requires replay to be clearly labeled
}
```

### Parsing rules (collector)

- Lines that match no pattern are **not emitted**; the collector counts them (`skipped_lines`).
- `Connection closed by invalid user ... [preauth]` is **not** emitted (it duplicates `ssh_invalid_user`).
- `Connection closed by <ip> port <port>` with no user (probes) is **not** emitted.
- A username may contain spaces or be empty; parse the IP/port from the end of the line, not by word position.
- Usernames longer than 64 chars are truncated to 64 and still emitted.
- For `ssh_success`, the key fingerprint stays inside `raw_message`; the API/investigator may extract it.

### Counting rule (API)

- A failed attempt = one distinct `(source_ip, source_port)` among failure types
  (`ssh_invalid_user`, `ssh_preauth_disconnect`, `ssh_failed_password`).

---

## 2. Transport

`POST /events`

- Body: JSON array of `SentinelEvent`, 1–500 items.
- Idempotent on `event_id`: duplicates are ignored, not errors.
- Response `200`: `{ "accepted": number, "duplicates": number }`. `400` on schema violation (whole batch rejected, with reason).
- Collector retries: 3 attempts, backoff 1s / 2s / 4s. On final failure it keeps its last
  **acknowledged** cursor in `COLLECTOR_STATE_FILE` and resumes with `journalctl --after-cursor`.
  No events are lost across restarts.

Collector → API runs on `127.0.0.1` (same host).

---

## 3. Detection (configurable via `.env`)

| Pattern label | Rule | Default |
|---|---|---|
| `burst` | ≥ `DETECT_FAST_COUNT` failures from one source within `DETECT_FAST_WINDOW_SECONDS` | 5 / 120 s |
| `low_and_slow` ⚖️ | ≥ `DETECT_SLOW_COUNT` failures from one source within `DETECT_SLOW_WINDOW_SECONDS` | 10 / 1800 s |
| `success_after_failures` | `ssh_success` from a source with failures in the active window | escalates |
| `new_source_success` | `ssh_success` from a source never seen succeeding before | low severity, informational |
| `spray` (P2) | ≥ `DETECT_SPRAY_DISTINCT_USERS` distinct usernames from one source in an incident | 5 |
| `privileged_target` (P2) | failures against `root` or sudo-group accounts | raises severity |

Incident key: `(host_id, source_ip)` while open. Local events (null IP) correlate by `(host_id, username)` within `DETECT_SLOW_WINDOW_SECONDS`.

---

## 4. Incident

```ts
type IncidentStatus =
  | "new" | "investigating" | "investigated"
  | "action_pending" | "action_applied" | "action_rejected" | "action_failed"
  | "closed";

type Severity = "low" | "medium" | "high";
// default: low_and_slow → low · burst → medium · success_after_failures → high

interface Incident {
  id: string;                    // "inc-001"
  host_id: string;
  source_ip: string | null;
  usernames: string[];           // distinct, capped at 50
  patterns: string[];            // labels from §3
  severity: Severity;
  status: IncidentStatus;
  first_seen: string;            // ISO-8601 UTC
  last_seen: string;
  event_ids: string[];
  failed_attempts: number;       // per counting rule in §1
  notification: { status: "pending" | "sent" | "failed"; attempts: number; last_attempt_at: string | null };
  investigation: Investigation | null;
  action: ResponseAction | null;
}
```

Escalation = severity increases or `success_after_failures` is added → at most one extra alert.

---

## 5. Investigation (Hugo)

```ts
interface Finding {
  kind: "observed" | "suspected" | "unknown";
  statement: string;
  evidence: string[];            // event_ids; MUST exist in the store. Required for observed/suspected.
}

interface Investigation {
  status: "ok" | "unavailable" | "failed";   // "unavailable" when the LLM is down: incident still valid
  summary: string;
  findings: Finding[];
  recommendation: string;
  mitre: string[];               // e.g. ["T1110.001", "T1078"]
  model: string;
  duration_ms: number;           // used for the "investigated in Xs" metric
  created_at: string;
}
```

Investigator tools (read-only): `get_incident_events(incident_id)`,
`get_auth_history(source_ip | username, window)`, `get_host_metadata(host_id)`.

---

## 6. Endpoints (API)

| Method | Path | Purpose |
|---|---|---|
| POST | `/events` | Ingest (§2). Localhost only. |
| GET | `/incidents` | List, newest first |
| GET | `/incidents/:id` | Detail incl. events, investigation, action |
| POST | `/incidents/:id/investigate` | (Re)run investigation |
| POST | `/actions/:id/approve` | Approve proposed response (policy re-checked) |
| POST | `/actions/:id/reject` | Reject |
| GET | `/health` | `{ collector_last_event_at, llm: "ok"|"down", telegram: "ok"|"failed", db: "ok" }` |
| GET/PUT | `/settings/llm` | ⚖️ **PROPOSED** BYO OpenAI key — see [`docs/proposals/settings-llm.md`](proposals/settings-llm.md). Do not treat as confirmed until team agreement. |

Dashboard and all non-ingest routes: HTTP basic auth (`DASHBOARD_USER` / `DASHBOARD_PASS`).

---

## 7. Telegram alert

```
Sentinel / suspicious SSH activity
Host: <host_id>
Source: <source_ip>
Pattern: <patterns, human-readable>
Severity: <severity>
Status: investigation pending
Open incident: <PUBLIC_BASE_URL>/incidents/<id>
```

One message per new incident; at most one per escalation; `NOTIFY_COOLDOWN_SECONDS` between
messages for the same incident. No raw logs, usernames lists, credentials, or tokens.

---

## 8. Response (P1)

```ts
interface ResponseAction {
  id: string;
  kind: "block_ip";
  target: string;                // IP
  ttl_seconds: number;           // RESPONSE_BLOCK_TTL_SECONDS
  status: "proposed" | "rejected_by_policy" | "approved" | "applied" | "verified" | "expired" | "rolled_back" | "failed";
  policy_reason: string | null;  // e.g. "target in RESPONSE_ALLOWLIST"
  applied_at: string | null;
  expires_at: string | null;
}
```

- Policy check runs at proposal **and** at approval. Allowlist = `RESPONSE_ALLOWLIST` CIDRs + the host's own IPs.
- Mechanism: nftables set `inet sentinel blocklist` with per-element timeout. Verify by listing the set.
- Runner is a separate privileged helper with a fixed command set. The API never builds shell strings.
