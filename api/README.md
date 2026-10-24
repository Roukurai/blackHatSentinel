# api (Node.js + TypeScript) — owners: Kevin (API, correlation, notifier), Hugo (investigator module)

Ingests `POST /events`, correlates SSH activity into incidents, and sends one Telegram alert per new incident (at most one extra alert on escalation). SQLite at `DB_PATH`. `getIncidentEvents` and `getAuthHistory` in `src/evidence.ts` are the read-only evidence lookups. Investigation and response actions are not in this slice. Telegram notification never waits for the investigator.

## Run

From the repository root, with Node 22.18+ (Node 24 on the VPS):

```bash
node --experimental-strip-types api/src/index.ts
```

The process reads the repo `.env`. `POST /events` accepts batches from localhost only. `GET /health`, `GET /incidents`, and `GET /incidents/:id` stay open on localhost until both `DASHBOARD_USER` and `DASHBOARD_PASS` are set; after that every caller needs HTTP basic auth.

## Investigator (Hugo)

Self-contained library: [`src/investigator/`](src/investigator/).

```ts
import {
  createInvestigator,
  loadLlmConfig,
  depsFromStore,
  scheduleInvestigation,
  healthLlmField,
} from "./investigator/index.js";

const investigator = createInvestigator(depsFromStore(store), loadLlmConfig());
investigator.startHealthProbe();

// After notifier.enqueue(...):
scheduleInvestigation(investigator, incident.id, async (id, inv) => {
  /* persist investigation; set status investigated|new */
});

// GET /health → llm: healthLlmField(investigator)
```

- Handshake + E2E checklist: [`src/investigator/HANDSHAKE.md`](src/investigator/HANDSHAKE.md)
- UI samples: [`src/investigator/samples/`](src/investigator/samples/)
- Live Grok: `LIVE_LLM=1 LLM_API_KEY=… npm test -- live.smoke`

## Test

`npm test` from `api/` runs the investigator suite and the API tests.

```bash
npm test --prefix api
```
