import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIncident } from "../api/queries";
import type { IncidentDetail as Detail } from "../api/types";
import { fmtDuration, fmtUtc, patternLabel, relAge, useNow } from "../lib/format";
import { Chip, OriginBadge, SeverityBadge, StatusBadge } from "./Badge";
import { InvestigationPanel } from "./InvestigationPanel";
import { NotificationStatus } from "./NotificationStatus";
import { ErrorState, SkeletonRows } from "./StateView";
import { Timeline } from "./Timeline";
import { Username } from "./Untrusted";

const HIGHLIGHT_MS = 1600;

export function IncidentDetail({ id }: { id: string }) {
  const { data, error, isPending, isError } = useIncident(id);

  if (isPending) return <SkeletonRows count={3} />;
  if (isError && !data) return <ErrorState error={error} what="Incident" />;
  if (!data) return null;

  return <DetailView inc={data} stale={isError} />;
}

function headline(inc: Detail): string {
  const src = inc.source_ip ?? "a local source";
  if (inc.patterns.includes("success_after_failures")) return `Successful login after failures from ${src}`;
  if (inc.patterns.includes("new_source_success")) return `Login from a new source: ${src}`;
  return `Suspicious SSH activity from ${src}`;
}

function DetailView({ inc, stale }: { inc: Detail; stale: boolean }) {
  const now = useNow();
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const events = inc.events;
  const loadedEventIds = useMemo(() => new Set(events?.map((e) => e.event_id) ?? []), [events]);

  const citedBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of inc.investigation?.findings ?? []) for (const id of f.evidence) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [inc.investigation]);

  const unresolvedCitations = [...citedBy.keys()].filter((id) => !loadedEventIds.has(id)).length;

  const focusEvent = useCallback((eventId: string) => {
    const el = document.getElementById(`ev-${eventId}`);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    setHighlighted(eventId);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
  }, []);

  const success = inc.patterns.includes("success_after_failures") || inc.patterns.includes("new_source_success");
  const spanSec = Math.max(0, Math.round((new Date(inc.last_seen).getTime() - new Date(inc.first_seen).getTime()) / 1000));

  return (
    <article className="detail">
      {stale && <div className="inline-warn">Connection lost. Showing last known state of this incident.</div>}

      <header className="detail__head">
        <div className="detail__badges">
          <SeverityBadge severity={inc.severity} />
          <StatusBadge status={inc.status} />
          <OriginBadge origin={inc.origin} />
          <span className="mono faint">{inc.id}</span>
        </div>
        <h1 className="detail__title">{headline(inc)}</h1>
        <div className="detail__patterns">
          {inc.patterns.map((p) => (
            <Chip key={p} tone={p === "success_after_failures" ? "warn" : undefined}>
              {patternLabel(p)}
            </Chip>
          ))}
        </div>
      </header>

      {success && (
        <div className="callout callout--warn">
          <strong>Suspicious, not confirmed.</strong> Authentication logs alone cannot prove a compromise. Verify with the
          account owner whether this login was expected.
        </div>
      )}

      <dl className="kv summary-grid">
        <dt>Source</dt>
        <dd className="mono">{inc.source_ip ?? "local"}</dd>
        <dt>Host</dt>
        <dd className="mono">{inc.host_id}</dd>
        <dt>First seen</dt>
        <dd className="mono">{fmtUtc(inc.first_seen)}</dd>
        <dt>Last seen</dt>
        <dd className="mono">
          {fmtUtc(inc.last_seen)} <span className="faint">({relAge(inc.last_seen, now)})</span>
        </dd>
        <dt>Span</dt>
        <dd className="mono">{fmtDuration(spanSec)}</dd>
        <dt>Failed attempts</dt>
        <dd className="mono">{inc.failed_attempts}</dd>
        <dt>Usernames</dt>
        <dd className="usernames">
          {inc.usernames.length === 0 && <span className="faint">—</span>}
          {inc.usernames.map((u, i) => (
            <Username key={i} value={u} />
          ))}
        </dd>
      </dl>

      <div className="detail__panels">
        <InvestigationPanel incident={inc} loadedEventIds={loadedEventIds} onFocusEvent={focusEvent} />
        <NotificationStatus n={inc.notification} />
      </div>

      <section className="panel" aria-label="Event timeline">
        <header className="panel__head">
          <h2 className="section-title">Timeline</h2>
          <span className="mono faint">
            {events ? `${events.length} of ${inc.event_ids.length} events` : `${inc.event_ids.length} events`}
          </span>
        </header>
        <EvidenceCompleteness inc={inc} unresolved={unresolvedCitations} />
        {events && events.length > 0 && <Timeline events={events} citedBy={citedBy} highlighted={highlighted} />}
      </section>
    </article>
  );
}

function EvidenceCompleteness({ inc, unresolved }: { inc: Detail; unresolved: number }) {
  const msgs: string[] = [];
  if (!inc.events) msgs.push("Event details were not included in the API response.");
  else if (inc.events.length < inc.event_ids.length)
    msgs.push(`Only ${inc.events.length} of ${inc.event_ids.length} linked events are loaded.`);
  if (unresolved > 0) msgs.push(`${unresolved} cited event${unresolved > 1 ? "s are" : " is"} not in the loaded timeline.`);
  if (msgs.length === 0) return null;
  return (
    <div className="callout callout--info">
      <strong>Evidence incomplete.</strong> {msgs.join(" ")}
    </div>
  );
}
