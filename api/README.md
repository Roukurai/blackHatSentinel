# api (Node.js + TypeScript) — owners: Kevin (API, correlation, notifier), Hugo (investigator module)

Ingests `POST /events`, correlates SSH activity into incidents, and sends one Telegram alert per new incident (at most one extra alert on escalation). SQLite at `DB_PATH`. After a successful Telegram send, the AI investigator runs asynchronously and stores `investigation` on the incident. Telegram never waits for the LLM.

## Run

From the repository root, with Node 22.18+ (Node 24 on the VPS):

```bash
node --experimental-strip-types api/src/index.ts
```

The process reads the repo `.env`. Set OpenAI `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` for live investigations. `POST /events` is localhost only. Dashboard routes use HTTP basic auth when `DASHBOARD_USER` / `DASHBOARD_PASS` are set.

## Investigator (Hugo)

Wiring: [`src/investigate.ts`](src/investigate.ts) + [`src/investigator/`](src/investigator/).

- After Telegram flush → `enqueueInvestigations`
- `POST /incidents/:id/investigate` re-runs
- `GET /health` → `llm: ok|down` via `healthLlmField`
- Handshake / E2E checklist: [`src/investigator/HANDSHAKE.md`](src/investigator/HANDSHAKE.md)
- Live smoke: `npm test --prefix api -- live.smoke` (loads repo `.env`)

## Test

```bash
npm test --prefix api
```
