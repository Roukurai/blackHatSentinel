/**
 * Simulates Kevin's integration path without a real SQLite store:
 * notify queued → scheduleInvestigation → persist → health field.
 */
import { describe, expect, it, vi } from "vitest";
import { createInvestigator, loadLlmConfig } from "../index.js";
import {
  healthLlmField,
  scheduleInvestigation,
  handleInvestigateRoute,
} from "../wire.js";
import {
  allFixtureDeps,
  burstIncident,
  demoIncident,
} from "./fixtures.js";
import type { Investigation } from "../types.js";

describe("e2e Kevin wiring (in-memory)", () => {
  it("without LLM key: investigation unavailable; llm health down", async () => {
    const cfg = loadLlmConfig({
      LLM_BASE_URL: "https://api.x.ai/v1",
      LLM_API_KEY: "",
      LLM_MODEL: "",
      LLM_TIMEOUT_SECONDS: "5",
    });
    expect(cfg.configured).toBe(false);

    const store = new Map<string, Investigation>();
    const investigator = createInvestigator(allFixtureDeps(), cfg);

    scheduleInvestigation(investigator, burstIncident.id, (id, inv) => {
      store.set(id, inv);
    });

    await vi.waitFor(() => expect(store.has(burstIncident.id)).toBe(true));
    const inv = store.get(burstIncident.id)!;
    expect(inv.status).toBe("unavailable");
    expect(inv.summary).toContain("AI investigation unavailable");
    expect(inv.findings).toEqual([]);
    expect(healthLlmField(investigator)).toBe("down");
  });

  it("POST /investigate style rerun with mock Grok returns ok", async () => {
    const investigator = createInvestigator(allFixtureDeps(), {
      baseUrl: "https://api.x.ai/v1",
      apiKey: "demo",
      model: "grok-test",
      timeoutSeconds: 10,
      configured: true,
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    summary:
                      "Failed passwords then success for demo from 203.0.113.77 (suspicious).",
                    findings: [
                      {
                        kind: "observed",
                        statement: "Failures then success from same source",
                        evidence: ["evt-demo-fail-001", "evt-demo-ok-001"],
                      },
                      {
                        kind: "suspected",
                        statement: "Possible credential guessing success",
                        evidence: ["evt-demo-ok-001"],
                      },
                    ],
                    recommendation: "Confirm if demo login was authorized.",
                    mitre: ["T1110.001", "T1078"],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });

    const result = await handleInvestigateRoute(
      investigator,
      demoIncident.id,
    );
    expect(result.status).toBe("ok");
    expect(result.findings.length).toBeGreaterThan(0);
    expect(
      result.findings.some((f) => /compromise is not confirmed/i.test(f.statement)),
    ).toBe(true);
  });
});
