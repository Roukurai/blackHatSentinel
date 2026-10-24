/**
 * Live OpenAI smoke — skipped unless LIVE_LLM=1 and LLM_* are configured.
 *
 *   LIVE_LLM=1 npm test -- live.smoke
 *   (reads repo .env via load-env.ts)
 */
import { describe, expect, it } from "vitest";
import { createInvestigator, loadLlmConfig } from "../index.ts";
import {
  allFixtureDeps,
  benignIncident,
  demoEvents,
  demoIncident,
  benignEvents,
} from "./fixtures.ts";

const cfgPreview = loadLlmConfig();
const live = process.env.LIVE_LLM === "1" && cfgPreview.configured;

describe.runIf(live)("live LLM smoke", () => {
  const cfg = loadLlmConfig();

  it(
    "demo success_after_failures returns ok with grounded evidence",
    async () => {
      const inv = createInvestigator(allFixtureDeps(), cfg);
      const r = await inv.investigate(demoIncident.id);
      console.log(
        "[live.smoke] demo",
        r.status,
        `duration_ms=${r.duration_ms}`,
        r.summary.slice(0, 120),
      );
      expect(r.status).toBe("ok");
      expect(r.root_cause).toBeTruthy();
      expect(r.remediation?.length).toBeGreaterThan(0);
      const known = new Set(demoEvents.map((e) => e.event_id));
      for (const id of r.root_cause!.evidence) expect(known.has(id)).toBe(true);
      for (const f of r.findings) {
        for (const id of f.evidence) expect(known.has(id)).toBe(true);
        if (f.kind === "observed") {
          expect(f.statement).not.toMatch(
            /compromis|breach|gained access|intrusion confirmed/i,
          );
        }
      }
      for (const step of r.remediation ?? []) {
        if (step.action) {
          expect(step.action.kind).toBe("block_ip");
          expect(step.action.target).toBe(demoIncident.source_ip);
        }
      }
    },
    60_000,
  );

  it(
    "benign new_ip known key keeps uncertainty",
    async () => {
      const inv = createInvestigator(allFixtureDeps(), cfg);
      const r = await inv.investigate(benignIncident.id);
      console.log(
        "[live.smoke] benign",
        r.status,
        `duration_ms=${r.duration_ms}`,
        r.summary.slice(0, 120),
      );
      expect(r.status).toBe("ok");
      const known = new Set(benignEvents.map((e) => e.event_id));
      for (const f of r.findings) {
        for (const id of f.evidence) expect(known.has(id)).toBe(true);
      }
      expect(
        r.findings.some(
          (f) =>
            f.kind === "unknown" ||
            /cannot|uncertain|not confirm|informational/i.test(f.statement) ||
            /cannot|uncertain|not confirm/i.test(r.summary),
        ),
      ).toBe(true);
    },
    60_000,
  );
});

describe.runIf(!live)("live LLM smoke (skipped)", () => {
  it("set LIVE_LLM=1 in .env (with LLM_*) to enable", () => {
    expect(true).toBe(true);
  });
});
