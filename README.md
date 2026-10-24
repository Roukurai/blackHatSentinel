<p align="center">
  <a href="https://sentinell.xyz"><img src="https://sentinell.xyz/opengraph-image" alt="Sentinell: every SSH attack on your server, explained" width="760"></a>
</p>

<h1 align="center">Sentinell</h1>

<p align="center">
  <strong>A self-hosted L1 security analyst for your Linux server.</strong><br>
  Every SSH attack, grouped into an incident, sent to Telegram, and explained with evidence.
</p>

<p align="center">
  <a href="https://sentinell.xyz">Website</a> ·
  <a href="docs/RUNNING.md">Run modes</a> ·
  <a href="docs/MCP.md">MCP</a> ·
  <a href="docs/CONTRACT.md">Interface contract</a> ·
  <a href="https://github.com/Roukurai/blackHatSentinel/issues">Issues</a>
</p>

<p align="center">
  <img alt="Status: prototype" src="https://img.shields.io/badge/status-prototype-f0503a">
  <img alt="Collector: Rust" src="https://img.shields.io/badge/collector-Rust-141210">
  <img alt="API: Node.js + TypeScript" src="https://img.shields.io/badge/api-Node%2022%2B%20%2B%20TypeScript-141210">
  <img alt="Dashboard: React" src="https://img.shields.io/badge/dashboard-React%2019-141210">
  <img alt="MCP" src="https://img.shields.io/badge/MCP-read--only-141210">
</p>

---

Sentinell watches SSH authentication on a single Ubuntu host. A small Rust collector reads sshd events from journald, a TypeScript API correlates them into incidents, and you get **one** Telegram alert per incident instead of a wall of log lines. An AI investigator with read-only evidence tools writes the L1 report, every finding cites the exact events it is based on, and an IP block only happens after a human approves it.

Everything runs on your own server. No Docker, no SaaS, bring your own model key.

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Principles](#principles)
- [Status](#status)
- [Quick start](#quick-start)
- [Connect your agent (MCP)](#connect-your-agent-mcp)
- [Configuration](#configuration)
- [Detection rules](#detection-rules)
- [HTTP API](#http-api)
- [Security model](#security-model)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Contributing](#contributing)
- [Team](#team)
- [License](#license)

## Features

- **Lightweight collector.** Rust, runs as an unprivileged user in the `systemd-journal` group. Resumes from the last acknowledged journal cursor, so no events are lost across restarts.
- **Incident correlation.** Bursts, low-and-slow guessing and success-after-failures from one source are linked into a single incident.
- **Deduplicated alerts.** One Telegram message per new incident, at most one more on escalation. Failed sends are logged and retried. Alerts never include credentials or raw log lines.
- **Evidence-cited investigation.** The investigator reads evidence only through typed tools. Findings that cite an unknown `event_id` are rejected, and every finding is labeled `observed`, `suspected` or `unknown`.
- **Bring your own model.** OpenAI, Anthropic, Gemini, OpenRouter or any OpenAI-compatible endpoint, set in `.env` or from the dashboard.
- **Human-approved response.** A temporary nftables block with expiry and rollback, executed by a restricted runner after approval. Allowlisted addresses can never be blocked.
- **Works without the AI.** Detection and alerting keep running when the model or the network is down.
- **Admin dashboard.** Incidents, timeline, evidence-linked findings, approvals, health, guided setup and settings, with a `⌘K` command menu.
- **Read-only MCP server.** Ask Claude, Cursor or Grok Bot about your incidents directly.
- **Replay mode.** Feed a `journalctl -o json` export through the same pipeline. Replayed data is always labeled `origin: "replay"`.

## How it works

```
 ┌──────────────┐  POST /events   ┌──────────────────────┐   one alert per incident   ┌──────────┐
 │   journald   │ ──────────────▶ │  API + SQLite        │ ─────────────────────────▶ │ Telegram │
 │  (sshd logs) │  Rust collector │  detection, incidents│                            └──────────┘
 └──────────────┘   localhost     └──────────┬───────────┘
                                             │ read-only evidence tools
                    ┌────────────────────────┼─────────────────────────┐
                    ▼                        ▼                         ▼
          ┌──────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
          │ AI investigator  │   │ Dashboard (React)    │   │ MCP server (stdio)   │
          │ cited findings   │   │ approve / reject     │   │ Claude, Cursor, Grok │
          └──────────────────┘   └──────────┬───────────┘   └──────────────────────┘
                                            │ approved
                                            ▼
                                 ┌──────────────────────┐
                                 │ restricted runner    │
                                 │ nftables, TTL, undo  │
                                 └──────────────────────┘
```

| Component | Path | What it does |
|---|---|---|
| Collector | [`collector/`](collector/) | Tails `journalctl -u ssh -o json --follow` (or a replay file), normalizes lines into `SentinelEvent`s, posts batches to the API with retry and backoff. |
| API | [`api/`](api/) | Validates and stores events in SQLite (idempotent on `event_id`), runs detection, opens and escalates incidents, sends Telegram alerts, serves the built dashboard. |
| Investigator | [`api/src/investigator/`](api/src/investigator/) | Bounded, read-only LLM investigation with typed, citation-checked findings and a deterministic fallback. |
| MCP server | [`api/src/mcp/`](api/src/mcp/) | Read-only stdio MCP server, started with `sentinell mcp`. |
| CLI | [`bin/sentinell`](bin/sentinell) | `sentinell mcp`, `sentinell status`. |
| Dashboard | [`web/`](web/) | Vite + React 19 admin UI. |
| Response runners | [`ops/responder/`](ops/responder/), [`ops/sentinel-block`](ops/sentinel-block) | The only privileged path: fixed `block` / `verify` / `unblock` commands with strict IP and TTL validation. |
| Ops | [`ops/`](ops/) | Installer, replay helper, reset, demo user and demo scenario. |
| Docs | [`docs/`](docs/) | [Interface contract](docs/CONTRACT.md), [run modes](docs/RUNNING.md), [MCP setup](docs/MCP.md). |

## Principles

These are enforced in code, not just documented.

1. **No invented events.** Every AI finding cites existing `event_id`s. Findings with unknown IDs are dropped.
2. **Honest uncertainty.** Auth logs alone never prove compromise. A success after failures is *suspicious*, not *compromised*.
3. **Attacker input is data.** `username` and `raw_message` are attacker-controlled. They are never passed to the model as instructions and are rendered as plain text in the UI, with hidden and bidi characters made visible.
4. **Read-only AI.** The model and the MCP server have evidence lookups only. No shell, no writes.
5. **Humans hold the trigger.** Responses that could lock someone out need explicit approval, and approval never bypasses the allowlist.

## Status

Sentinell started as a hackathon project and is a working prototype. Scope today is **one Ubuntu host, SSH authentication**. It is not a production endpoint security product yet.

| Area | State |
|---|---|
| Collector: live journald, replay, cursor resume | ✅ |
| API: ingestion, detection, incidents, Telegram with dedup and retry | ✅ |
| AI investigator wired into the API, BYO provider keys | ✅ |
| Response actions: approve / reject, restricted nftables runner | ✅ |
| Dashboard: incidents, findings, approvals, setup, settings | ✅ |
| MCP server and `sentinell` CLI, installer script | ✅ |
| `spray` and `privileged_target` detection | 🗺️ Planned |
| systemd units, prebuilt binaries | 🗺️ Planned |
| More event types (`sudo_denied`, `user_created`, `cron_changed`, `ssh_flood`) | 🗺️ Reserved in the contract |

## Quick start

### Requirements

- Ubuntu 22.04+ with systemd and journald (developed on 24.04)
- Node.js **22.18+** (uses `--experimental-strip-types`; Node 24 recommended) and git
- Rust stable (`rustup`) to build the collector and responder
- A Telegram bot token and chat ID ([BotFather](https://t.me/BotFather))
- Optional: an API key for an LLM provider

### 1. Install

```bash
git clone https://github.com/Roukurai/blackHatSentinel.git
cd blackHatSentinel
bash ops/install.sh
```

The installer installs the API and dashboard dependencies, builds the collector if `cargo` is available, creates `.env` from [`.env.example`](.env.example) and links the `sentinell` CLI into `~/.local/bin`. It clones into `~/sentinell` when run outside a clone.

### 2. Configure

```bash
$EDITOR .env     # HOST_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, RESPONSE_ALLOWLIST
```

The model key can go in `.env` (`LLM_*`) or be added later from the dashboard's **AI provider** page.

### 3. Start the API and dashboard

```bash
npm run build --prefix web     # the API serves web/dist (WEB_DIST)
npm start --prefix api
```

Open `http://<host>:8080`. The **Setup** page walks through whatever is still missing.

### 4. Start the collector

Create a dedicated user that can read the journal and nothing else, then run the collector with the same `.env`:

```bash
sudo useradd --system --create-home --groups systemd-journal sentinel
sudo install -d -o sentinel -g sentinel /var/lib/sentinel
sudo -u sentinel bash -c 'set -a; source .env; set +a; ./collector/target/release/collector'
```

For replaying captured data instead of the live journal, see [`docs/RUNNING.md`](docs/RUNNING.md) and [`ops/replay.sh`](ops/replay.sh).

### 5. Enable responses (optional)

Build and install the restricted runner, then point `RESPONSE_RUNNER` at it. Full steps, nftables bootstrap and the sudoers entry are in [`ops/sentinel-responder.install.md`](ops/sentinel-responder.install.md). With no runner configured, approvals fail honestly instead of pretending to block.

### 6. Try it safely

[`ops/enable-demo-user.sh`](ops/enable-demo-user.sh) creates a `demo` user that is the only account allowed to use password auth. [`ops/demo-scenario.sh`](ops/demo-scenario.sh), run from a **different machine you control**, produces a short burst of failures followed by one success. You should get one Telegram alert and an incident labeled `success_after_failures`.

Only run the demo against servers you own. [`ops/reset.sh`](ops/reset.sh) wipes incident state and the block set between runs.

## Connect your agent (MCP)

Sentinell ships a read-only MCP server so coding agents can list incidents and read evidence.

```bash
claude mcp add sentinell -- sentinell mcp
```

For Cursor, Grok Bot and other clients, use this server definition:

```json
{
  "mcpServers": {
    "sentinell": { "command": "sentinell", "args": ["mcp"] }
  }
}
```

More in [`docs/MCP.md`](docs/MCP.md). [sentinell.xyz](https://sentinell.xyz) has copy-paste setup prompts for each agent.

## Configuration

All settings live in `.env` (see [`.env.example`](.env.example)).

| Variable | Default | Description |
|---|---|---|
| `HOST_ID` | `ubuntu-01` | Name for this host. Always taken from config, never parsed from logs. |
| `API_BIND` / `API_PORT` | `0.0.0.0` / `8080` | Where the API listens. Use `127.0.0.1` behind a reverse proxy. |
| `API_URL` | `http://127.0.0.1:8080` | Where the collector posts events. Ingest only accepts loopback. |
| `PUBLIC_BASE_URL` | | Base URL used in Telegram links to the dashboard. |
| `DB_PATH` | `./data/sentinel.db` | SQLite database file. |
| `WEB_DIST` | `web/dist` | Built dashboard served by the API. |
| `DASHBOARD_USER` / `DASHBOARD_PASS` | | When both are set, every endpoint except ingest requires HTTP basic auth. |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | | Alert destination. |
| `NOTIFY_COOLDOWN_SECONDS` | `300` | Minimum gap between alerts for the same incident. |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint. |
| `LLM_API_KEY` / `LLM_MODEL` | / `gpt-4o-mini` | Model credentials and name. Can also be set from the dashboard. |
| `LLM_TIMEOUT_SECONDS` | `30` | Investigation timeout. |
| `DETECT_*` | see below | Detection thresholds. |
| `RESPONSE_ALLOWLIST` | | Comma-separated CIDRs that can never be blocked: your own IPs, the server, your team. |
| `RESPONSE_BLOCK_TTL_SECONDS` | `600` | Lifetime of a temporary block. |
| `RESPONSE_RUNNER` | | Path to the restricted runner. Empty disables blocking. |
| `RESPONSE_RUNNER_SUDO` | `0` | `1` runs the runner through `sudo -n`. |
| `COLLECTOR_MODE` | `live` | `live` or `replay`. |
| `COLLECTOR_REPLAY_FILE` | | `journalctl -o json` export for replay mode. |
| `COLLECTOR_STATE_FILE` | `/var/lib/sentinel/cursor` | Last acknowledged journal cursor. |
| `COLLECTOR_BATCH_MAX` | `500` | Events per POST. |

## Detection rules

A failed attempt is one distinct `(source_ip, source_port)` among `ssh_invalid_user`, `ssh_preauth_disconnect` and `ssh_failed_password`. Incidents are keyed by `(host_id, source_ip)` while open.

| Pattern | Rule | Default |
|---|---|---|
| `burst` | ≥ `DETECT_FAST_COUNT` failures from one source within `DETECT_FAST_WINDOW_SECONDS` | 5 in 120 s |
| `low_and_slow` | ≥ `DETECT_SLOW_COUNT` failures from one source within `DETECT_SLOW_WINDOW_SECONDS` | 10 in 30 min |
| `success_after_failures` | `ssh_success` from a source with failures in the active window | escalates |
| `new_source_success` | `ssh_success` from a source never seen succeeding before | informational |
| `spray` (planned) | ≥ `DETECT_SPRAY_DISTINCT_USERS` distinct usernames from one source | 5 |

Full details in [`docs/CONTRACT.md`](docs/CONTRACT.md).

## HTTP API

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/events` | loopback only | Ingest 1–500 `SentinelEvent`s. Idempotent on `event_id`. Returns `{ accepted, duplicates }`. |
| `GET` | `/health` | basic auth if set | Collector freshness, Telegram, LLM and DB status. |
| `GET` | `/incidents` | basic auth if set | All incidents. |
| `GET` | `/incidents/:id` | basic auth if set | One incident with its events, investigation and action. |
| `POST` | `/incidents/:id/investigate` | basic auth if set | Run or re-run the investigation. |
| `POST` | `/actions/:id/approve` · `/reject` | basic auth if set | Decide on a proposed response. |
| `GET` | `/settings/overview` | basic auth if set | Read-only configuration summary for the dashboard. |
| `GET` / `PUT` | `/settings/llm` | basic auth if set | Read or set the model provider. Keys are never returned. |

## Security model

- **Ingest is local.** `POST /events` rejects anything that is not loopback.
- **Least privilege.** The collector runs as `sentinel`, a member of `systemd-journal` only. The response runner is the only privileged path, with a fixed command set and an argument vector, never a shell string.
- **Protect the dashboard.** Set `DASHBOARD_USER` and `DASHBOARD_PASS`, and put the API behind TLS (a reverse proxy such as Caddy or nginx) before exposing it.
- **Secrets stay in `.env`.** It is git-ignored. Never commit it, databases or raw journal exports.
- **Untrusted input.** Log contents are treated as hostile end to end: schema-validated on ingest, passed to the model as quoted data, and rendered as plain text.

Found a vulnerability? Please report it privately to the maintainers instead of opening a public issue.

## Repository layout

```
.
├── collector/   Rust journald collector (live + replay)
├── api/         Node.js + TypeScript API, detection, notifier, actions
│   └── src/
│       ├── investigator/   bounded AI investigator
│       └── mcp/            read-only MCP server
├── web/         React admin dashboard
├── bin/         sentinell CLI
├── ops/         installer, responder, sentinel-block, replay, reset, demo
├── docs/        CONTRACT.md, RUNNING.md, MCP.md
└── .env.example
```

## Development

```bash
npm test --prefix api                                     # API + investigator tests
npm run typecheck --prefix api
cargo test --manifest-path collector/Cargo.toml           # collector parser tests
cargo test --manifest-path ops/responder/Cargo.toml       # responder tests
npm run build --prefix web                                # type-check + production build
npm run dev:fixtures --prefix web                         # dashboard on sample data, no API needed
```

## Contributing

Issues and pull requests are welcome.

- Read [`AGENTS.md`](AGENTS.md) and [`docs/CONTRACT.md`](docs/CONTRACT.md) first. Interface changes need agreement from every affected owner.
- Keep commits small and use the component prefix: `collector:`, `api:`, `investigator:`, `web:`, `ops:`, `docs:`.
- `git pull --rebase` before pushing. Never force-push `main`.
- Never commit `.env`, databases or raw journal exports. Replay data must stay labeled `origin: "replay"`.

## Team

| Area | Maintainer |
|---|---|
| Collector, ops, response runner | Antonio |
| API, correlation, notifier | Kevin |
| AI investigator, MCP | Hugo |
| Dashboard, website | Jordi |

Built at the **Grok Bot Guatemala Hackathon** (Alaris Security, Universidad del Istmo), October 2026.

## License

No license has been chosen yet. Until a `LICENSE` file is added, all rights are reserved by the authors.
