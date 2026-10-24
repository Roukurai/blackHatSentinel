import { ApiError, FIXTURE_MODE } from "../api/client";
import { useHealth } from "../api/queries";
import { relAge, useNow } from "../lib/format";

type Tone = "ok" | "warn" | "bad" | "neutral";

function Item({ label, value, tone, title }: { label: string; value: string; tone: Tone; title?: string }) {
  return (
    <div className="health__item" title={title}>
      <span className={`dot dot--${tone}`} aria-hidden="true" />
      <span className="health__label">{label}</span>
      <span className="health__value">{value}</span>
    </div>
  );
}

// A quiet server is not a broken collector: show the age of the last event,
// never "down", unless the API itself tells us so.
const COLLECTOR_QUIET_MS = 5 * 60_000;

export function HealthStrip() {
  const { data, error, isError, dataUpdatedAt } = useHealth();
  const now = useNow();

  const apiTone: Tone = isError ? (error instanceof ApiError && error.kind === "auth" ? "warn" : "bad") : data ? "ok" : "neutral";
  const apiValue = isError
    ? error instanceof ApiError && error.kind === "auth"
      ? "sign-in needed"
      : "unreachable"
    : data
      ? FIXTURE_MODE
        ? "fixtures"
        : "ok"
      : "…";

  const stale = isError && data;
  const lastEvent = data?.collector_last_event_at ?? null;
  const lastEventAge = lastEvent ? now - new Date(lastEvent).getTime() : Infinity;

  return (
    <div className={`health${stale ? " health--stale" : ""}`} aria-label="System health">
      <Item label="API" value={apiValue} tone={apiTone} />
      {data && (
        <>
          <Item
            label="Collector"
            value={lastEvent ? `last event ${relAge(lastEvent, now)}` : "no events yet"}
            tone={lastEventAge < COLLECTOR_QUIET_MS ? "ok" : "neutral"}
            title="Time since the collector delivered the most recent SSH event"
          />
          <Item label="AI" value={data.llm === "ok" ? "ok" : "down"} tone={data.llm === "ok" ? "ok" : "warn"} title="Detection and alerts do not depend on the AI" />
          <Item label="Telegram" value={data.telegram} tone={data.telegram === "ok" ? "ok" : "bad"} />
          <Item label="DB" value={data.db} tone={data.db === "ok" ? "ok" : "bad"} />
        </>
      )}
      {stale && <span className="health__stale">stale · last update {relAge(new Date(dataUpdatedAt).toISOString(), now)}</span>}
    </div>
  );
}
