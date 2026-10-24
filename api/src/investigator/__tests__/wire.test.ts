import { describe, expect, it, vi } from "vitest";
import { createInvestigator } from "../index.js";
import {
  handleInvestigateRoute,
  healthLlmField,
  scheduleInvestigation,
} from "../wire.js";
import { allFixtureDeps, burstIncident } from "./fixtures.js";

function unconfigured() {
  return createInvestigator(allFixtureDeps(), {
    baseUrl: "https://api.x.ai/v1",
    apiKey: "",
    model: "",
    timeoutSeconds: 5,
    configured: false,
  });
}

describe("wire helpers", () => {
  it("scheduleInvestigation persists unavailable without key", async () => {
    const inv = unconfigured();
    const persist = vi.fn();
    scheduleInvestigation(inv, burstIncident.id, persist);
    await vi.waitFor(() => expect(persist).toHaveBeenCalled());
    const [, investigation] = persist.mock.calls[0];
    expect(investigation.status).toBe("unavailable");
    expect(healthLlmField(inv)).toBe("down");
  });

  it("handleInvestigateRoute returns investigation", async () => {
    const r = await handleInvestigateRoute(unconfigured(), burstIncident.id);
    expect(r.status).toBe("unavailable");
    expect(r.summary).toContain("AI investigation unavailable");
  });

  it("scheduleInvestigation does not reject when persist throws", async () => {
    const inv = unconfigured();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const persist = vi.fn(async () => {
      throw new Error("sqlite locked");
    });
    scheduleInvestigation(inv, burstIncident.id, persist);
    await vi.waitFor(() => expect(persist).toHaveBeenCalled());
    // Give the catch path a tick
    await new Promise((r) => setTimeout(r, 20));
    expect(errSpy).toHaveBeenCalled();
    const logged = errSpy.mock.calls.some(
      (c) => String(c[0]).includes("persist failed"),
    );
    expect(logged).toBe(true);
    errSpy.mockRestore();
  });

  it("handleInvestigateRoute still returns investigation when persist throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const persist = vi.fn(async () => {
      throw new Error("sqlite locked");
    });
    const r = await handleInvestigateRoute(
      unconfigured(),
      burstIncident.id,
      persist,
    );
    expect(r.status).toBe("unavailable");
    expect(persist).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
