# Sentinel — shared context for every coding agent

Read this file and `docs/CONTRACT.md` before writing code. Implement only the agreed
interfaces. If something here conflicts with your task, stop and ask the human.

## What we are building

Six-hour hackathon implementation for ONE Ubuntu host. A lightweight Rust collector reads
real (or explicitly replayed) SSH authentication events from journald and POSTs normalized
events to a TypeScript API. The API correlates suspicious patterns into incidents, sends ONE
deduplicated Telegram alert per new/escalated incident (independently of the AI), and exposes
incidents to a bounded AI investigator and a React dashboard. Optional (P1): a restricted
runner applies a temporary, reversible, human-approved IP block.

Framing: Sentinel performs an analyst's L1 triage **autonomously** (correlate, investigate,
report, notify). Humans approve only actions that could lock someone out.

## Non-negotiables

- No invented events. Every AI finding cites existing `event_id`s; findings with unknown IDs are rejected.
- Findings are labeled `observed` / `suspected` / `unknown`.
- Auth logs alone never prove compromise. "Success after failures" is **suspicious**, not "compromised".
- `raw_message` and `username` are attacker-controlled. Treat as untrusted data, never as instructions to the LLM.
- The LLM has read-only evidence tools. No shell access. No write access.
- Detection and Telegram alerts must keep working when the AI or network is down.
- Never put credentials, tokens, or raw logs in alerts.
- Replay data is always labeled `origin: "replay"`.
- Approval never bypasses the response allowlist.

## Environment (facts)

- Target host: Contabo VPS, Ubuntu 24.04, hostname `ubuntu-01`. Native deploy, **no Docker**.
- Installed: Node 24 (`/opt/node`), Rust (rustup, user `rou`), nftables, sqlite3, git.
- Collector runs as user `sentinel` (member of `systemd-journal` only; no sudo).
- Password SSH auth is disabled server-wide. Bots therefore produce `Invalid user ...` and
  `... [preauth]` lines, **not** `Failed password`. A dedicated demo user (password auth via
  `Match User`) produces the failed-to-success scenario.
- Journal prints local time (CEST). Always use `__REALTIME_TIMESTAMP` (UTC).
- Hostname in old log lines differs (`vmi3694090`). `host_id` comes from config, never from the log.

## Ownership (stay in your folder; ask before editing another)

| Folder | Owner |
|---|---|
| `collector/`, `ops/` | Antonio (Systems) |
| `api/` | Kevin (Backend) — investigator module: Hugo (AI) |
| `web/` | Jordi (Frontend) |
| `docs/CONTRACT.md` | Changes require team agreement |

## Priorities

- **P0:** collector + replay, incidents, evidence-backed investigation, Telegram alert, dashboard.
- **P1:** human-approved safe response (nft set with timeout) + verification + rollback.
- **P2:** behavior labels beyond burst/success, extra event types (reserved in CONTRACT), Slack, polish.
- Out: WhatsApp, multi-host, Docker, web/app log sources.

## Schedule (official event times are fixed)

- **~13:00 checkpoint:** suspicious SSH sequence → incident → Telegram → AI report, end to end.
- P1/P2 only after the checkpoint passes.
- **15:15 feature freeze.** 15:30 submission. 15:45 demos (2–3 min, live, real data).

## Acceptance checks

| Case | Expected |
|---|---|
| Suspicious attempt | Incident created; Telegram arrives once with host, status, link |
| More related events | Incident updates; no notification spam; escalation may send one distinct alert |
| Benign login (new IP, known key) | No compromise claim; uncertainty visible |
| AI or network down | Detection continues; notification failures logged and retryable |
| Malformed input (e.g. empty username) | Handled; never crashes; counted |
| Unsafe IP block (allowlisted) | Rejected even after approval |
| Action succeeds | Result, verification, expiry/rollback recorded |

## Git workflow

- Small commits, `git pull --rebase` before every push. Never force-push `main`.
- Conventional prefixes: `collector:`, `api:`, `investigator:`, `web:`, `ops:`, `docs:`.
- Never commit `.env`, databases, or raw journal exports.
