import { loadLlmConfig } from "./config.js";
import { HealthTracker } from "./health.js";
import { runInvestigation } from "./run.js";
import type {
  Investigator,
  InvestigatorDeps,
  Investigation,
  LlmConfig,
} from "./types.js";

export { loadLlmConfig } from "./config.js";
export {
  scheduleInvestigation,
  handleInvestigateRoute,
  healthLlmField,
} from "./wire.js";
export type {
  Finding,
  Investigation,
  Investigator,
  InvestigatorDeps,
  HostMetadata,
  LlmConfig,
  Incident,
  SentinelEvent,
} from "./types.js";

export function createInvestigator(
  deps: InvestigatorDeps,
  cfg: LlmConfig = loadLlmConfig(),
): Investigator {
  const health = new HealthTracker(cfg);
  const inflight = new Map<string, Promise<Investigation>>();

  return {
    investigate(incidentId: string): Promise<Investigation> {
      const existing = inflight.get(incidentId);
      if (existing) return existing;

      const p = runInvestigation(deps, cfg, health, incidentId).finally(() => {
        inflight.delete(incidentId);
      });
      inflight.set(incidentId, p);
      return p;
    },

    llmHealth(): "ok" | "down" {
      return health.llmHealth();
    },

    startHealthProbe(): () => void {
      return health.startHealthProbe();
    },
  };
}
