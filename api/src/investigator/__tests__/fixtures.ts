import type {
  Incident,
  InvestigatorDeps,
  SentinelEvent,
} from "../types.js";

function ev(
  partial: Omit<SentinelEvent, "host_id" | "origin"> & {
    host_id?: string;
    origin?: "live" | "replay";
  },
): SentinelEvent {
  return {
    host_id: partial.host_id ?? "ubuntu-01",
    origin: partial.origin ?? "replay",
    ...partial,
  };
}

/** Burst from 192.0.2.50 including empty username */
export const burstEvents: SentinelEvent[] = [
  ev({
    event_id: "evt-burst-001",
    timestamp: "2026-10-24T15:00:01.000Z",
    type: "ssh_invalid_user",
    username: "user",
    source_ip: "192.0.2.50",
    source_port: 40001,
    raw_message: "Invalid user user from 192.0.2.50 port 40001",
  }),
  ev({
    event_id: "evt-burst-002",
    timestamp: "2026-10-24T15:00:02.000Z",
    type: "ssh_invalid_user",
    username: "user",
    source_ip: "192.0.2.50",
    source_port: 40002,
    raw_message: "Invalid user user from 192.0.2.50 port 40002",
  }),
  ev({
    event_id: "evt-burst-003",
    timestamp: "2026-10-24T15:00:03.000Z",
    type: "ssh_invalid_user",
    username: "user",
    source_ip: "192.0.2.50",
    source_port: 40003,
    raw_message: "Invalid user user from 192.0.2.50 port 40003",
  }),
  ev({
    event_id: "evt-burst-004",
    timestamp: "2026-10-24T15:00:04.000Z",
    type: "ssh_invalid_user",
    username: "user",
    source_ip: "192.0.2.50",
    source_port: 40004,
    raw_message: "Invalid user user from 192.0.2.50 port 40004",
  }),
  ev({
    event_id: "evt-burst-005",
    timestamp: "2026-10-24T15:00:05.000Z",
    type: "ssh_invalid_user",
    username: "user",
    source_ip: "192.0.2.50",
    source_port: 40005,
    raw_message: "Invalid user user from 192.0.2.50 port 40005",
  }),
  ev({
    event_id: "evt-burst-admin-001",
    timestamp: "2026-10-24T15:00:06.000Z",
    type: "ssh_invalid_user",
    username: "admin",
    source_ip: "192.0.2.50",
    source_port: 40006,
    raw_message: "Invalid user admin from 192.0.2.50 port 40006",
  }),
  ev({
    event_id: "evt-burst-empty-001",
    timestamp: "2026-10-24T15:00:07.000Z",
    type: "ssh_invalid_user",
    username: "",
    source_ip: "192.0.2.50",
    source_port: 40007,
    raw_message: "Invalid user  from 192.0.2.50 port 40007",
  }),
];

export const demoEvents: SentinelEvent[] = [
  ...Array.from({ length: 6 }, (_, i) =>
    ev({
      event_id: `evt-demo-fail-00${i + 1}`,
      timestamp: `2026-10-24T16:00:0${i + 1}.000Z`,
      type: "ssh_failed_password",
      username: "demo",
      source_ip: "203.0.113.77",
      source_port: 50001 + i,
      raw_message: `Failed password for demo from 203.0.113.77 port ${50001 + i} ssh2`,
    }),
  ),
  ev({
    event_id: "evt-demo-ok-001",
    timestamp: "2026-10-24T16:00:10.000Z",
    type: "ssh_success",
    username: "demo",
    source_ip: "203.0.113.77",
    source_port: 50010,
    raw_message:
      "Accepted password for demo from 203.0.113.77 port 50010 ssh2",
  }),
];

const ROU_FP = "SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCD=";

export const benignEvents: SentinelEvent[] = [
  ev({
    event_id: "evt-rou-prior-001",
    timestamp: "2026-10-20T10:00:00.000Z",
    type: "ssh_success",
    username: "rou",
    source_ip: "198.51.100.10",
    source_port: 22001,
    raw_message: `Accepted publickey for rou from 198.51.100.10 port 22001 ssh2: ED25519 ${ROU_FP}`,
  }),
  ev({
    event_id: "evt-rou-ok-001",
    timestamp: "2026-10-24T16:30:00.000Z",
    type: "ssh_success",
    username: "rou",
    source_ip: "203.0.113.200",
    source_port: 22002,
    raw_message: `Accepted publickey for rou from 203.0.113.200 port 22002 ssh2: ED25519 ${ROU_FP}`,
  }),
];

export function makeIncident(
  id: string,
  events: SentinelEvent[],
  patterns: string[],
  severity: Incident["severity"],
): Incident {
  const usernames = [
    ...new Set(
      events
        .map((e) => e.username)
        .filter((u): u is string => u !== null),
    ),
  ];
  return {
    id,
    host_id: "ubuntu-01",
    source_ip: events[0]?.source_ip ?? null,
    usernames,
    patterns,
    severity,
    status: "investigating",
    first_seen: events[0]?.timestamp ?? new Date().toISOString(),
    last_seen: events[events.length - 1]?.timestamp ?? new Date().toISOString(),
    event_ids: events.map((e) => e.event_id),
    failed_attempts: events.filter((e) =>
      ["ssh_invalid_user", "ssh_preauth_disconnect", "ssh_failed_password"].includes(
        e.type,
      ),
    ).length,
    notification: { status: "sent", attempts: 1, last_attempt_at: new Date().toISOString() },
    investigation: null,
    action: null,
  };
}

export const burstIncident = makeIncident("inc-burst", burstEvents, ["burst"], "medium");
export const demoIncident = makeIncident(
  "inc-demo",
  demoEvents,
  ["burst", "success_after_failures"],
  "high",
);
export const benignIncident = makeIncident(
  "inc-benign",
  [benignEvents[1]],
  ["new_source_success"],
  "low",
);

export function createMemoryDeps(
  incidents: Incident[],
  allEvents: SentinelEvent[],
  now = new Date("2026-10-24T17:00:00.000Z"),
): InvestigatorDeps {
  const byId = new Map(incidents.map((i) => [i.id, i]));
  const eventsById = new Map(allEvents.map((e) => [e.event_id, e]));

  return {
    now: () => now,
    getIncident(id) {
      return byId.get(id) ?? null;
    },
    getEventsByIds(ids) {
      return ids
        .map((id) => eventsById.get(id))
        .filter((e): e is SentinelEvent => Boolean(e));
    },
    getAuthHistory(q) {
      return allEvents
        .filter((e) => {
          if (e.timestamp < q.since || e.timestamp > q.until) return false;
          if (q.source_ip) return e.source_ip === q.source_ip;
          if (q.username !== undefined) return e.username === q.username;
          return false;
        })
        .slice(0, q.limit);
    },
  };
}

export function allFixtureDeps(): InvestigatorDeps {
  return createMemoryDeps(
    [burstIncident, demoIncident, benignIncident],
    [...burstEvents, ...demoEvents, ...benignEvents],
  );
}
