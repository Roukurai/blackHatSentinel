# api (Node.js + TypeScript) — owners: Kevin (API, correlation, notifier), Hugo (investigator module)

Ingests `POST /events`, correlates SSH activity into incidents, and sends one Telegram alert per new incident (at most one extra alert on escalation). SQLite at `DB_PATH`. Investigation and response actions are not in this slice. Telegram notification never waits for the investigator.

## Run

From the repository root, with Node 22.18+ (Node 24 on the VPS):

```bash
node --experimental-strip-types api/src/index.ts
```

The process reads the repo `.env`. `POST /events` accepts batches from localhost only. `GET /health`, `GET /incidents`, and `GET /incidents/:id` stay open on localhost until both `DASHBOARD_USER` and `DASHBOARD_PASS` are set; after that every caller needs HTTP basic auth.

## Test

```bash
npm test --prefix api
```
