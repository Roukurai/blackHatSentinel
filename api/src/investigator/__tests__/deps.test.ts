import { describe, expect, it } from "vitest";
import { depsFromStore } from "../deps.ts";
import {
  allFixtureDeps,
  burstIncident,
  burstEvents,
} from "./fixtures.ts";

describe("depsFromStore", () => {
  it("forwards store methods onto InvestigatorDeps", async () => {
    const memory = allFixtureDeps();
    const deps = depsFromStore({
      getIncident: (id) => memory.getIncident(id),
      getEventsByIds: (ids) => memory.getEventsByIds(ids),
      getAuthHistory: (q) => memory.getAuthHistory(q),
      now: () => new Date("2026-10-24T17:00:00.000Z"),
    });

    const incident = await deps.getIncident(burstIncident.id);
    expect(incident?.id).toBe(burstIncident.id);

    const events = await deps.getEventsByIds(burstIncident.event_ids);
    expect(events.map((e) => e.event_id)).toEqual(
      burstEvents.map((e) => e.event_id),
    );

    const hist = await deps.getAuthHistory({
      source_ip: "192.0.2.50",
      since: "2026-10-24T00:00:00.000Z",
      until: "2026-10-24T23:59:59.000Z",
      limit: 100,
    });
    expect(hist.length).toBeGreaterThan(0);
    expect(hist.every((e) => e.origin === "replay")).toBe(true);
  });
});
