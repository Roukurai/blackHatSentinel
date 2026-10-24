# Investigator ↔ Kevin / Jordi handshake

Status: **Hugo module ready.** Kevin: implement `InvestigatorDeps` against SQLite and call the helpers below.

## Kevin: wire after Telegram is queued

```ts
import {
  createInvestigator,
  loadLlmConfig,
  scheduleInvestigation,
  handleInvestigateRoute,
  healthLlmField,
} from "./investigator/index.js";

const investigator = createInvestigator(storeAsDeps, loadLlmConfig());
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

Verified without LLM key: investigation returns `unavailable`, Telegram path stays independent (`__tests__/e2e.flow.test.ts`).

### `InvestigatorDeps` Kevin must implement

- `getIncident(id)`
- `getEventsByIds(ids)`
- `getAuthHistory({ source_ip?, username?, since, until, limit })`
- `getHostMetadata?(host_id)` (optional)

Hugo never writes the DB. Telegram must not await the investigator.

## Jordi: sample payloads

See `samples/*.json` for burst, success-after-failures, and benign new-IP / known-key UI fixtures.
