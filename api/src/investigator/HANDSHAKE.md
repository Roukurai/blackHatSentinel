# Investigator ↔ Kevin / Jordi handshake

Status: **Hugo module ready** (PR to `main`). Kevin: implement store methods and call the helpers below.

## Kevin: wire after Telegram is queued

```ts
import {
  createInvestigator,
  loadLlmConfig,
  depsFromStore,
  scheduleInvestigation,
  handleInvestigateRoute,
  healthLlmField,
} from "./investigator/index.js";

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

## E2E checklist (checkpoint — needs Kevin + Antonio)

Blocked until ingest / incidents / Telegram exist on the API.

- [ ] Kevin merges investigator and wires `depsFromStore` + `scheduleInvestigation` after notifier enqueue
- [ ] `LLM_*` + `HOST_ID` set on VPS (never committed)
- [ ] `LIVE_LLM=1` with `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` → `npm test -- live.smoke` passes
- [ ] `ops/demo-scenario.sh` → incident → one Telegram → investigation on `GET /incidents/:id` → dashboard findings
- [ ] Unset `LLM_API_KEY`, restart API → Telegram still fires; investigation `unavailable`; `/health` `llm: "down"`
