import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useIncident } from "../api/queries";
import type { IncidentDetail as Detail } from "../api/types";
import { fmtDuration, fmtUtc, relAge, useNow } from "../lib/format";
import { IncidentStatusDot, NotificationDot, OriginBadge, PatternBadge, SeverityBadge } from "./Badge";
import { ActionSection } from "./ActionPanel";
import { InvestigationSection } from "./InvestigationPanel";
import { ErrorState, SkeletonRows } from "./StateView";
import { Timeline } from "./Timeline";
import { Note } from "./ui";
import { Username } from "./Untrusted";

const HIGHLIGHT_MS = 1600;

export function IncidentPage({ id }: { id: string }) {
  const { data, error, isPending, isError } = useIncident(id);

  return (
    <div className="page">
      <Link to="/" className="back-link">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10 3.5 5.5 8 10 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Incidents
      </Link>
      {isPending && (
        <div className="card">
          <SkeletonRows count={3} height={88} />
        </div>
      )}
      {isError && !data && <ErrorState error={error} what="Incident" />}
      {data && <DetailView inc={data} stale={isError} />}
    </div>
  );
}

function headline(inc: Detail): string {
  if (inc.patterns.includes("success_after_failures")) return "Successful login after failures";
  if (inc.patterns.includes("new_source_success")) return "Login from a new source";
  if (inc.patterns.includes("low_and_slow")) return "Slow authentication attempts";
  return "Suspicious SSH activity";
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`field${wide ? " field--wide" : ""}`}>
      <dt className="field__label">{label}</dt>
      <dd className="field__value">{children}</dd>
    </div>
  );
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
  const n = inc.notification;

  return (
    <article className="detail">
      {stale && <Note type="warning">Connection lost. Showing the last known state of this incident.</Note>}

      <header className="page-head">
        <div>
          <h1 className="h-page">{headline(inc)}</h1>
          <p className="sub">
            <span className="mono">{inc.source_ip ?? "local source"}</span> on <span className="mono">{inc.host_id}</span> ·{" "}
            <span className="mono">{inc.id}</span>
          </p>
        </div>
      </header>

      {success && (
        <Note type="warning" label="Suspicious, not confirmed">
          Authentication logs alone cannot prove a compromise. Verify with the account owner whether this login was expected.
        </Note>
      )}

      <section className="card overview">
        <dl className="overview__grid">
          <Field label="Status">
            <IncidentStatusDot status={inc.status} />
          </Field>
          <Field label="Severity">
            <SeverityBadge severity={inc.severity} />
          </Field>
          <Field label="Source">
            <span className="mono">{inc.source_ip ?? "local"}</span>
          </Field>
          <Field label="Failed attempts">
            <span className="mono">{inc.failed_attempts}</span>
          </Field>
          <Field label="First seen">
            <span className="mono">{fmtUtc(inc.first_seen)}</span>
          </Field>
          <Field label="Last seen">
            <span className="mono" title={fmtUtc(inc.last_seen)}>
              {relAge(inc.last_seen, now)}
            </span>
            <span className="muted"> · span {fmtDuration(spanSec)}</span>
          </Field>
          <Field label="Telegram alert">
            <NotificationDot status={n.status} />
            <span className="muted">
              {" "}
              · {n.attempts} attempt{n.attempts === 1 ? "" : "s"}
              {n.last_attempt_at && <> · {relAge(n.last_attempt_at, now)}</>}
            </span>
          </Field>
          <Field label="Data origin">
            {inc.origin ? (
              inc.origin === "live" ? (
                "Live"
              ) : (
                <OriginBadge origin={inc.origin} />
              )
            ) : (
              <span className="muted">See events</span>
            )}
          </Field>
          <Field label="Patterns" wide>
            <span className="badges">
              {inc.patterns.map((p) => (
                <PatternBadge key={p} pattern={p} />
              ))}
            </span>
          </Field>
          <Field label="Usernames" wide>
            <span className="usernames">
              {inc.usernames.length === 0 && <span className="muted">—</span>}
              {inc.usernames.map((u, i) => (
                <Username key={i} value={u} />
              ))}
            </span>
          </Field>
        </dl>
        {n.status === "failed" && (
          <div className="overview__foot">Alert delivery failed. Detection is unaffected; the failure is logged by the API.</div>
        )}
      </section>

      <InvestigationSection incident={inc} loadedEventIds={loadedEventIds} onFocusEvent={focusEvent} />

      <ActionSection incident={inc} />

      <section className="section" aria-label="Events">
        <header className="section-head">
          <h2 className="h-section">Events</h2>
          <span className="muted mono">
            {events ? `${events.length} of ${inc.event_ids.length}` : inc.event_ids.length}
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
  else if (inc.events.length < inc.event_ids.length) msgs.push(`Only ${inc.events.length} of ${inc.event_ids.length} linked events are loaded.`);
  if (unresolved > 0) msgs.push(`${unresolved} cited event${unresolved > 1 ? "s are" : " is"} not in the loaded timeline.`);
  if (msgs.length === 0) return null;
  return <Note label="Evidence incomplete">{msgs.join(" ")}</Note>;
}
