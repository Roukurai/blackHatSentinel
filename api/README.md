# api (Node.js + TypeScript) — owners: Kevin (API, correlation, notifier), Hugo (investigator module)

Implements `docs/CONTRACT.md` §2–§8. SQLite at `DB_PATH`. Serves the built `web/` assets.
Telegram notification never waits for the investigator.

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
- Tests: `npm test` from `api/`
- Live LLM: `LIVE_LLM=1 LLM_BASE_URL=… LLM_API_KEY=… LLM_MODEL=… npm test -- live.smoke`

Kevin: after merging this module, rebase and add API dependencies to this `package.json` (do not create a second package root).
