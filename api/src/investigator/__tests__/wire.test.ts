import { describe, expect, it, vi } from "vitest";
import { createInvestigator } from "../index.js";
import {
  handleInvestigateRoute,
  healthLlmField,
  scheduleInvestigation,
} from "../wire.js";
import { allFixtureDeps, burstIncident } from "./fixtures.js";

describe("wire helpers", () => {
  it("scheduleInvestigation persists unavailable without key", async () => {
    const inv = createInvestigator(allFixtureDeps(), {
      baseUrl: "https://api.x.ai/v1",
      apiKey: "",
      model: "",
      timeoutSeconds: 5,
      configured: false,
    });
    const persist = vi.fn();
    scheduleInvestigation(inv, burstIncident.id, persist);
    await vi.waitFor(() => expect(persist).toHaveBeenCalled());
    const [, investigation] = persist.mock.calls[0];
    expect(investigation.status).toBe("unavailable");
    expect(healthLlmField(inv)).toBe("down");
  });

  it("handleInvestigateRoute returns investigation", async () => {
    const inv = createInvestigator(allFixtureDeps(), {
      baseUrl: "https://api.x.ai/v1",
      apiKey: "",
      model: "",
      timeoutSeconds: 5,
      configured: false,
    });
    const r = await handleInvestigateRoute(inv, burstIncident.id);
    expect(r.status).toBe("unavailable");
    expect(r.summary).toContain("AI investigation unavailable");
  });
});
