import { Link } from "react-router-dom";
import { ApiError, FIXTURE_MODE } from "../api/client";
import { useHealth } from "../api/queries";
import { fmtUtc, relAge, useNow } from "../lib/format";
import { StatusDot, type Tone } from "./ui";

interface Service {
  name: string;
  tone: Tone;
  value: string;
  detail: string;
}

// A quiet server is not a broken collector: show the age of the last event,
// never "down", unless the API itself says so.
const COLLECTOR_QUIET_MS = 5 * 60_000;

function useServices() {
  const q = useHealth();
  const now = useNow();
  const { data, error, isError } = q;
  const auth = error instanceof ApiError && error.kind === "auth";

  const services: Service[] = [
    {
      name: "API",
      tone: isError ? (auth ? "amber" : "red") : data ? "green" : "gray",
      value: isError ? (auth ? "Sign-in needed" : "Unreachable") : data ? (FIXTURE_MODE ? "Fixtures" : "Operational") : "Checking…",
      detail: "Event ingestion, correlation and this dashboard",
    },
  ];

  if (data) {
    const last = data.collector_last_event_at;
    const age = last ? now - new Date(last).getTime() : Infinity;
    services.push(
      {
        name: "Collector",
        tone: age < COLLECTOR_QUIET_MS ? "green" : "gray",
        value: last ? `Last event ${relAge(last, now)}` : "No events yet",
        detail: last ? `SSH journal reader · last event ${fmtUtc(last)}` : "SSH journal reader",
      },
      {
        name: "AI investigator",
        tone: data.llm === "ok" ? "green" : "amber",
        value: data.llm === "ok" ? "Operational" : "Unavailable",
        detail: "Detection and alerts do not depend on the AI",
      },
      {
        name: "Telegram",
        tone: data.telegram === "ok" ? "green" : "red",
        value: data.telegram === "ok" ? "Operational" : "Delivery failing",
        detail: "Incident alerts. Failures are logged and retryable",
      },
      {
        name: "Database",
        tone: data.db === "ok" ? "green" : "red",
        value: data.db === "ok" ? "Operational" : data.db,
        detail: "SQLite event and incident store",
      },
    );
  }

  return { ...q, services, now };
}

export function HealthIndicator() {
  const { services, isError, data } = useServices();
  const worst: Tone = services.some((s) => s.tone === "red")
    ? "red"
    : services.some((s) => s.tone === "amber")
      ? "amber"
      : data
        ? "green"
        : "gray";
  const label =
    isError && !data
      ? services[0]!.value === "Sign-in needed"
        ? "Sign-in needed"
        : "API unreachable"
      : worst === "green"
        ? "All systems normal"
        : worst === "gray"
          ? "Checking…"
          : `${services.filter((s) => s.tone === "red" || s.tone === "amber").map((s) => s.name).join(", ")} degraded`;

  return (
    <Link to="/health" className="health-pill" title="System health">
      <StatusDot tone={isError ? "red" : worst} label={label} />
    </Link>
  );
}

export function HealthPage() {
  const { services, isError, data, dataUpdatedAt, now } = useServices();
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="h-page">Health</h1>
          <p className="sub">Status of the Sentinel pipeline on this host.</p>
        </div>
      </header>
      {isError && data && (
        <p className="sub warn-text">Stale · last successful check {relAge(new Date(dataUpdatedAt).toISOString(), now)}</p>
      )}
      <ul className="card list-card">
        {services.map((s) => (
          <li key={s.name} className="svc-row">
            <span className="svc-row__name">{s.name}</span>
            <StatusDot tone={s.tone} label={s.value} />
            <span className="svc-row__detail">{s.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
