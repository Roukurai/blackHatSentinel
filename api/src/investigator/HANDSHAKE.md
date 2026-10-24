# Investigator ↔ Kevin / Jordi handshake

Status: **Wired on `investigator/wire-api`** — API calls `scheduleInvestigation` after successful Telegram flush; persists `investigation_json`; `POST /incidents/:id/investigate`; `/health` uses `healthLlmField`.

## Kevin: wire after Telegram is queued

```ts
import {
  createInvestigator,
  loadLlmConfig,
  depsFromStore,
  scheduleInvestigation,
  handleInvestigateRoute,
  healthLlmField,
} from "./investigator/index.ts";

const investigator = createInvestigator(depsFromStore(store), loadLlmConfig());
investigator.startHealthProbe();

// On incident create / escalate — AFTER notifier.enqueue(...):
incident.status = "investigating";
scheduleInvestigation(investigator, incident.id, async (id, investigation) => {
  // persist investigation on incident
  // status = investigation.status === "ok" ? "investigated" : "new"
});

// POST /incidents/:id/investigate → handleInvestigateRoute(investigator, id, persist)
// GET /health → llm: healthLlmField(investigator)
```

`HOST_ID` must be in the API process env (defaults to `ubuntu-01` inside the investigator).

Verified without LLM key: investigation returns `unavailable`, Telegram path stays independent (`__tests__/e2e.flow.test.ts`). Persist failures are logged and do not crash the process.

### Store shape (`InvestigatorStore` → `depsFromStore`)

Implement on SQLite (or any store):

- `getIncident(id)`
- `getEventsByIds(ids)`
- `getAuthHistory({ source_ip?, username?, since, until, limit })` — exactly one of `source_ip` / `username`; order by timestamp; cap `limit`; **include `origin`** so replay stays labeled
- `getHostMetadata?(host_id)` (optional)

Hugo never writes the DB. Telegram must not await the investigator.

## Jordi: sample payloads

See `samples/*.json` for burst, success-after-failures, and benign new-IP / known-key UI fixtures.

## E2E checklist (checkpoint — needs Antonio + VPS env)

Wiring on this branch is done (`investigate.ts` + `enqueueInvestigations` after `flushNotifications`). Remaining is live env + demo:

- [x] Wire `depsFromDatabase` + `enqueueInvestigations` after Telegram flush
- [ ] `LLM_*` + `HOST_ID` set on VPS (never committed); OpenAI defaults in `.env.example`
- [ ] `LIVE_LLM=1 npm test -- live.smoke` passes on VPS (or local with key)
- [ ] `ops/demo-scenario.sh` → incident → one Telegram → investigation on `GET /incidents/:id` → dashboard findings
- [ ] Unset `LLM_API_KEY`, restart API → Telegram still fires; investigation `unavailable`; `/health` `llm: "down"`
