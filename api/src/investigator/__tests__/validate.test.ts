import { describe, expect, it } from "vitest";
import { validateModelOutput } from "../validate.js";
import { demoEvents, demoIncident } from "./fixtures.js";

describe("validateModelOutput", () => {
  const seen = new Set(demoEvents.map((e) => e.event_id));

  it("rejects invented event ids", () => {
    const r = validateModelOutput(
      {
        summary: "ok",
        findings: [
          {
            kind: "observed",
            statement: "fake",
            evidence: ["does-not-exist"],
          },
        ],
        recommendation: "",
        mitre: [],
      },
      demoIncident,
      seen,
      demoEvents,
    );
    expect(r.rejected_findings).toBe(1);
    expect(r.findings.every((f) => f.evidence[0] !== "does-not-exist")).toBe(
      true,
    );
  });

  it("rejects observed without evidence", () => {
    const r = validateModelOutput(
      {
        summary: "ok",
        findings: [{ kind: "observed", statement: "x", evidence: [] }],
        recommendation: "",
        mitre: [],
      },
      demoIncident,
      seen,
      demoEvents,
    );
    expect(r.rejected_findings).toBe(1);
  });

  it("keeps unknown without evidence", () => {
    const r = validateModelOutput(
      {
        summary: "ok",
        findings: [{ kind: "unknown", statement: "gap", evidence: [] }],
        recommendation: "",
        mitre: [],
      },
      demoIncident,
      seen,
      demoEvents,
    );
    expect(r.findings.some((f) => f.statement === "gap")).toBe(true);
  });

  it("rejects observed compromise wording", () => {
    const r = validateModelOutput(
      {
        summary: "suspected activity",
        findings: [
          {
            kind: "observed",
            statement: "Host is compromised",
            evidence: ["evt-demo-ok-001"],
          },
        ],
        recommendation: "",
        mitre: [],
      },
      demoIncident,
      seen,
      demoEvents,
    );
    expect(r.rejected_findings).toBe(1);
  });

  it("filters unknown MITRE ids", () => {
    const r = validateModelOutput(
      {
        summary: "ok",
        findings: [],
        recommendation: "",
        mitre: ["T1110.001", "T9999", "not-an-id"],
      },
      demoIncident,
      seen,
      demoEvents,
    );
    expect(r.mitre).toEqual(["T1110.001"]);
  });

  it("adds fixed unknown finding when ssh_success present", () => {
    const r = validateModelOutput(
      {
        summary: "ok",
        findings: [],
        recommendation: "",
        mitre: [],
      },
      demoIncident,
      seen,
      demoEvents,
    );
    expect(
      r.findings.some(
        (f) =>
          f.kind === "unknown" &&
          /compromise is not confirmed/i.test(f.statement),
      ),
    ).toBe(true);
  });
});
