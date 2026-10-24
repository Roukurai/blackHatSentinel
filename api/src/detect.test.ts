import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { evaluate } from "./detect.ts";
import type { DetectConfig, SentinelEvent } from "./types.ts";

const detect: DetectConfig = {
  fastCount: 5,
  fastWindowMs: 120_000,
  slowCount: 10,
  slowWindowMs: 1_800_000,
};

function ev(index: number, fields: Partial<SentinelEvent> = {}): SentinelEvent {
  const event: SentinelEvent = {
    event_id: createHash("sha256").update(`detect-${index}`).digest("hex"),
    host_id: "ubuntu-01",
    timestamp: new Date(Date.parse("2026-10-24T18:00:00.000Z") + index * 1000).toISOString(),
    type: "ssh_invalid_user",
    username: "root",
    source_ip: "203.0.113.10",
    source_port: 40000 + index,
    raw_message: "RAW_SHOULD_NOT_LEAK",
    origin: "replay",
    ...fields,
  };
  return event;
}

test("same connection is one failed attempt", () => {
  const events = [0, 1, 2, 3, 4].flatMap((index) => [
    ev(index, { type: "ssh_invalid_user", source_port: 2200, username: "root" }),
    ev(index + 100, { type: "ssh_preauth_disconnect", source_port: 2200, username: "root" }),
  ]);
  assert.equal(evaluate(events, detect), null);
});

test("a new username on the same port counts as another attempt", () => {
  const events = [0, 1, 2, 3, 4].map((index) => ev(index, {
    source_port: 30000,
    username: `user-${index}`,
  }));
  const found = evaluate(events, detect);
  assert.equal(found?.failedAttempts, 5);
  assert.deepEqual(found?.patterns, ["burst"]);
  assert.equal(found?.severity, "medium");
});
