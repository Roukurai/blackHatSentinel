import { describe, expect, it, vi } from "vitest";
import { createInvestigator } from "../index.ts";
import type { LlmConfig } from "../types.ts";
import { allFixtureDeps, burstIncident } from "./fixtures.ts";

function cfg(over: Partial<LlmConfig> = {}): LlmConfig {
  return {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "gpt-test",
    timeoutSeconds: 5,
    configured: true,
    ...over,
  };
}

describe("investigate failure modes", () => {
  it("returns unavailable without calling fetch when not configured", async () => {
    const fetchFn = vi.fn();
    const inv = createInvestigator(
      allFixtureDeps(),
      cfg({ configured: false, apiKey: "", model: "", fetch: fetchFn }),
    );
    const r = await inv.investigate(burstIncident.id);
    expect(r.status).toBe("unavailable");
    expect(r.model).toBe("none");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(r.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("returns unavailable when fetch throws", async () => {
    const inv = createInvestigator(
      allFixtureDeps(),
      cfg({
        fetch: async () => {
          throw new TypeError("network down");
        },
      }),
    );
    const r = await inv.investigate(burstIncident.id);
    expect(r.status).toBe("unavailable");
  });

  it("returns unavailable on timeout", async () => {
    const inv = createInvestigator(
      allFixtureDeps(),
      cfg({
        timeoutSeconds: 1,
        fetch: async (_url, init) => {
          await new Promise((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          });
          throw new Error("unreachable");
        },
      }),
    );
    const r = await inv.investigate(burstIncident.id);
    expect(r.status).toBe("unavailable");
  }, 10_000);

  it("returns failed on HTTP 401", async () => {
    const inv = createInvestigator(
      allFixtureDeps(),
      cfg({
        fetch: async () =>
          new Response("unauthorized", { status: 401 }),
      }),
    );
    const r = await inv.investigate(burstIncident.id);
    expect(r.status).toBe("failed");
  });

  it("investigate never rejects", async () => {
    const inv = createInvestigator(
      allFixtureDeps(),
      cfg({
        fetch: async () => {
          throw new Error("boom");
        },
      }),
    );
    await expect(inv.investigate(burstIncident.id)).resolves.toMatchObject({
      status: "unavailable",
    });
  });

  it("dedups concurrent investigates for same id", async () => {
    let calls = 0;
    const inv = createInvestigator(
      allFixtureDeps(),
      cfg({
        fetch: async () => {
          calls++;
          await new Promise((r) => setTimeout(r, 50));
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: JSON.stringify({
                      summary: "burst seen",
                      findings: [
                        {
                          kind: "observed",
                          statement: "failures from source",
                          evidence: ["evt-burst-001"],
                        },
                      ],
                      recommendation: "watch",
                      mitre: ["T1110.001"],
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      }),
    );
    const [a, b] = await Promise.all([
      inv.investigate(burstIncident.id),
      inv.investigate(burstIncident.id),
    ]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
    expect(a.status).toBe("ok");
  });
});
