import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Incident, Severity } from "../api/types";
import { useIncidents } from "../api/queries";
import { fmtUtc, relAge, useNow } from "../lib/format";
import { IncidentStatusDot, OriginBadge, PatternBadge, SeverityBadge } from "./Badge";
import { ErrorState, SkeletonRows } from "./StateView";
import { EmptyState, Note } from "./ui";

type SevFilter = "all" | Severity;

export function IncidentsPage() {
  const { data, error, isPending, isError } = useIncidents();
  const now = useNow();
  const [query, setQuery] = useState("");
  const [sev, setSev] = useState<SevFilter>("all");

  // Contract says newest first; sort defensively so ordering never depends on it.
  const sorted = useMemo(() => (data ? [...data].sort((a, b) => b.last_seen.localeCompare(a.last_seen)) : undefined), [data]);
  const q = query.trim().toLowerCase();
  const visible = sorted?.filter(
    (i) => (sev === "all" || i.severity === sev) && (!q || i.id.toLowerCase().includes(q) || (i.source_ip ?? "").toLowerCase().includes(q)),
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="h-page">Incidents</h1>
          <p className="sub">Correlated SSH authentication activity on this host, newest first.</p>
        </div>
      </header>

      <div className="filters">
        <div className="g-input">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            placeholder="Filter by IP or incident ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter incidents"
            spellCheck={false}
          />
        </div>
        <select className="g-select" value={sev} onChange={(e) => setSev(e.target.value as SevFilter)} aria-label="Severity">
          <option value="all">All severities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {isError && !data && <ErrorState error={error} what="Incidents" />}
      {isError && data && <Note type="warning">Connection lost. Showing last known data, retrying.</Note>}

      {isPending && (
        <div className="card">
          <SkeletonRows count={5} />
        </div>
      )}

      {data && data.length === 0 && (
        <div className="card">
          <EmptyState title="No incidents">Sentinel is watching SSH activity. Suspicious patterns will appear here.</EmptyState>
        </div>
      )}

      {visible && data && data.length > 0 && (
        <div className="card list-card">
          {visible.length === 0 ? (
            <EmptyState title="No matching incidents">Clear the filter to see all {data.length} incidents.</EmptyState>
          ) : (
            <ol className="inc-list">
              {visible.map((inc) => (
                <li key={inc.id}>
                  <IncidentRow inc={inc} now={now} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function IncidentRow({ inc, now }: { inc: Incident; now: number }) {
  return (
    <Link to={`/incidents/${encodeURIComponent(inc.id)}`} className="inc-row">
      <div className="inc-row__col inc-row__primary">
        <span className="inc-row__ip">{inc.source_ip ?? "local"}</span>
        <span className="inc-row__sub">
          <span className="mono">{inc.id}</span>
          <SeverityBadge severity={inc.severity} />
        </span>
      </div>
      <div className="inc-row__col">
        <IncidentStatusDot status={inc.status} />
        <span className="inc-row__sub">
          <span className="mono">{inc.failed_attempts}</span> failed attempts
        </span>
      </div>
      <div className="inc-row__col inc-row__patterns">
        <span className="badges">
          {inc.patterns.map((p) => (
            <PatternBadge key={p} pattern={p} />
          ))}
          <OriginBadge origin={inc.origin} />
        </span>
        <span className="inc-row__sub">{inc.usernames.length} username{inc.usernames.length === 1 ? "" : "s"}</span>
      </div>
      <div className="inc-row__col inc-row__time">
        <span title={fmtUtc(inc.last_seen)}>{relAge(inc.last_seen, now)}</span>
        <span className="inc-row__sub mono">{fmtUtc(inc.first_seen).slice(11)}</span>
      </div>
      <svg className="inc-row__chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}
