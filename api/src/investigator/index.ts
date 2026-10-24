import { loadLlmConfig } from "./config.ts";
import { HealthTracker } from "./health.ts";
import { runInvestigation } from "./run.ts";
import type {
  Investigator,
  InvestigatorDeps,
  Investigation,
  LlmConfig,
} from "./types.ts";

export { loadLlmConfig } from "./config.ts";
export { depsFromStore } from "./deps.ts";
export type { InvestigatorStore } from "./deps.ts";
export {
  scheduleInvestigation,
  handleInvestigateRoute,
  healthLlmField,
} from "./wire.ts";
export type {
  Finding,
  Investigation,
  Investigator,
  InvestigatorDeps,
  HostMetadata,
  LlmConfig,
  Incident,
  SentinelEvent,
} from "./types.ts";

export function createInvestigator(
  deps: InvestigatorDeps,
  cfg: LlmConfig | (() => LlmConfig) = loadLlmConfig,
): Investigator {
  const getCfg = typeof cfg === "function" ? cfg : () => cfg;
  const health = new HealthTracker(getCfg);
  const inflight = new Map<string, Promise<Investigation>>();

  return {
    investigate(incidentId: string): Promise<Investigation> {
      const existing = inflight.get(incidentId);
      if (existing) return existing;

      const p = runInvestigation(deps, getCfg(), health, incidentId).finally(() => {
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
