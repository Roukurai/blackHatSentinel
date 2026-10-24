# api (Node.js + TypeScript) — owners: Kevin (API, correlation, notifier), Hugo (investigator module)

Ingests `POST /events`, correlates SSH activity into incidents, and sends one Telegram alert per new incident (at most one extra alert on escalation). SQLite at `DB_PATH`. After each Telegram attempt (sent or failed) the AI investigator runs asynchronously and stores `investigation` on the incident; Telegram never waits for the LLM, and a Telegram outage never stops the investigation. Medium/high incidents with a source IP get a proposed temporary block (`action`). The API also serves the built dashboard.

## Run

From the repository root, with Node 22.18+ (Node 24 on the VPS):

```bash
node --experimental-strip-types api/src/index.ts
```

The process reads the repo `.env`. Set OpenAI `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` for live investigations, or use dashboard **Settings** (`GET/PUT /settings/llm`) to bring your own key without restart. `POST /events` is localhost only. On first launch, with no dashboard password, `GET /auth/status` reports `configured: false` and every other dashboard route returns `401 setup_required`. `POST /setup` stores a hash beside the database and starts the session. After that, routes accept the session cookie from `POST /login` or HTTP basic auth. `DASHBOARD_USER` / `DASHBOARD_PASS` are the same gate when set in `.env` before a password is chosen in the browser.

Read-only MCP: `sentinell mcp` (see [`docs/MCP.md`](../docs/MCP.md)).

## Dashboard

Build once with `npm ci --prefix web && npm run build --prefix web`. The API serves `web/dist` (override with `WEB_DIST`). Browser navigations (`Accept: text/html`) and static assets are public so the sign-in page can render; API calls (`Accept: application/json`) stay behind the session or basic auth. The Telegram link `PUBLIC_BASE_URL/incidents/<id>` opens the dashboard, then the sign-in screen if a password is set. `POST /logout` clears the cookie. Failed sign-ins are limited to 8 per minute per address.

## Response actions (P1)

- `POST /actions/:id/approve` re-checks policy (`RESPONSE_ALLOWLIST` CIDRs, this host's own addresses, loopback), then runs `RESPONSE_RUNNER block <ip> <ttl>` and `verify <ip>` with `execFile` (no shell). Status: `proposed → approved → applied → verified`, `expired` after `RESPONSE_BLOCK_TTL_SECONDS`.
- Policy refusal returns `403 {"error": reason}`; approving anything not `proposed` returns `409`.
- Without `RESPONSE_RUNNER` an approval is recorded as `failed` ("runner not configured"); nothing is faked.
- `POST /actions/:id/reject` sets incident status `action_rejected`.
- Runner: [`ops/sentinel-block`](../ops/sentinel-block) (install steps in its header; `RESPONSE_RUNNER_SUDO=1` runs it via `sudo -n`).

## Investigator (Hugo)

Wiring: [`src/investigate.ts`](src/investigate.ts) + [`src/investigator/`](src/investigator/).

- After each Telegram flush → `flushAndFollowUp` (`src/pipeline.ts`) proposes actions and calls `enqueueInvestigations` for every incident that was due (skips ones already investigating or with nothing new)
- `POST /incidents/:id/investigate` re-runs
- `GET /health` → `llm: ok|down` via `healthLlmField`
- Handshake / E2E checklist: [`src/investigator/HANDSHAKE.md`](src/investigator/HANDSHAKE.md)
- Live smoke: `npm test --prefix api -- live.smoke` (loads repo `.env`)

## Test

```bash
npm test --prefix api          # vitest (investigator) + node:test (api)
npm run typecheck --prefix api # tsc, imports use .ts extensions
```
