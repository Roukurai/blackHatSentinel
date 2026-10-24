# api (Node.js + TypeScript) — owners: Kevin (API, correlation, notifier), Hugo (investigator module)

Implements `docs/CONTRACT.md` §2–§8. SQLite at `DB_PATH`. Serves the built `web/` assets.
Telegram notification never waits for the investigator.

## Investigator (Hugo)

Self-contained library: [`src/investigator/`](src/investigator/).

```ts
import {
  createInvestigator,
  loadLlmConfig,
} from "./investigator/index.js";
import { scheduleInvestigation, healthLlmField } from "./investigator/wire.js";

const investigator = createInvestigator(deps, loadLlmConfig());
investigator.startHealthProbe();

// After notifier.enqueue(...):
scheduleInvestigation(investigator, incident.id, async (id, inv) => {
  /* persist investigation; set status investigated|new */
});

// GET /health → llm: healthLlmField(investigator)
```

- Handshake: [`src/investigator/HANDSHAKE.md`](src/investigator/HANDSHAKE.md)
- UI samples: [`src/investigator/samples/`](src/investigator/samples/)
- Tests: `npm test` from `api/`

