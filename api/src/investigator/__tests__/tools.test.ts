import { describe, expect, it } from "vitest";
import {
  executeTool,
  extractAuthFields,
  prefetchIncidentEvents,
  type ToolContext,
} from "../tools.ts";
import {
  allFixtureDeps,
  benignEvents,
  burstIncident,
} from "./fixtures.ts";

function ctx(incidentId = burstIncident.id): ToolContext {
  return {
    deps: allFixtureDeps(),
    incidentId,
    seenEventIds: new Set(),
    hostIdFallback: "ubuntu-01",
  };
}

describe("tools", () => {
  it("refuses out-of-scope incident_id", async () => {
    const r = await executeTool(
      ctx(),
      "get_incident_events",
      JSON.stringify({ incident_id: "other" }),
    );
    expect(r).toEqual({ error: "out_of_scope" });
  });

  it("rejects both or neither source_ip/username", async () => {
    const both = await executeTool(
      ctx(),
      "get_auth_history",
      JSON.stringify({ source_ip: "1.1.1.1", username: "x", window: "1h" }),
    );
    expect(both).toEqual({
      error: "provide_exactly_one_of_source_ip_or_username",
    });
    const neither = await executeTool(
      ctx(),
      "get_auth_history",
      JSON.stringify({ window: "1h" }),
    );
    expect(neither).toEqual({
      error: "provide_exactly_one_of_source_ip_or_username",
    });
  });

  it("rejects invalid window", async () => {
    const r = await executeTool(
      ctx(),
      "get_auth_history",
      JSON.stringify({ source_ip: "192.0.2.50", window: "30d" }),
    );
    expect(r).toEqual({ error: "invalid_window" });
  });

  it("caps and tracks seen event ids on prefetch", async () => {
    const c = ctx();
    const pre = await prefetchIncidentEvents(c);
    expect("payload" in pre).toBe(true);
    if ("payload" in pre) {
      const payload = pre.payload as { events: unknown[] };
      expect(payload.events.length).toBeGreaterThan(0);
      expect(c.seenEventIds.has("evt-burst-001")).toBe(true);
    }
  });

  it("extracts fingerprint and prior_success_same_key", async () => {
    const { key_fingerprint, auth_method } = extractAuthFields(
      benignEvents[1].raw_message,
    );
    expect(auth_method).toBe("publickey");
    expect(key_fingerprint?.startsWith("SHA256:")).toBe(true);

    const c = ctx("inc-benign");
    const hist = (await executeTool(
      c,
      "get_auth_history",
      JSON.stringify({ username: "rou", window: "7d" }),
    )) as { events: Array<{ prior_success_same_key?: boolean }> };

    const withPrior = hist.events.filter((e) => e.prior_success_same_key);
    expect(withPrior.length).toBeGreaterThan(0);
  });

  it("never includes raw_message in sanitized events", async () => {
    const c = ctx();
    const pre = await prefetchIncidentEvents(c);
    if ("payload" in pre) {
      const payload = pre.payload as { events: Record<string, unknown>[] };
      for (const e of payload.events) {
        expect(e).not.toHaveProperty("raw_message");
      }
    }
  });
});
