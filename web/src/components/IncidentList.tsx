import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Incident } from "../api/types";
import { useIncidents } from "../api/queries";
import { fmtUtc, patternLabel, relAge, useNow } from "../lib/format";
import { Chip, OriginBadge, SeverityBadge, StatusBadge } from "./Badge";
import { ErrorState, SkeletonRows, StateView } from "./StateView";

export function IncidentList({ selectedId }: { selectedId: string | undefined }) {
  const { data, error, isPending, isError } = useIncidents();
  const now = useNow();
  // Contract says newest first; sort defensively so ordering never depends on it.
  const sorted = useMemo(() => (data ? [...data].sort((a, b) => b.last_seen.localeCompare(a.last_seen)) : undefined), [data]);

  return (
    <section className="list" aria-label="Incidents">
      <header className="list__head">
        <h2 className="section-title">Incidents</h2>
        {data && <span className="count mono">{data.length}</span>}
      </header>

      {isError && !data && <ErrorState error={error} what="Incidents" />}
      {isError && data && <div className="inline-warn">Showing last known data. Retrying…</div>}
      {isPending && <SkeletonRows />}
      {data && data.length === 0 && (
        <StateView title="No incidents">Sentinel is watching SSH activity. Suspicious patterns will appear here.</StateView>
      )}

      {sorted && sorted.length > 0 && (
        <ol className="list__items">
          {sorted.map((inc) => (
            <li key={inc.id}>
              <IncidentRow inc={inc} selected={inc.id === selectedId} now={now} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function IncidentRow({ inc, selected, now }: { inc: Incident; selected: boolean; now: number }) {
  return (
    <Link
      to={`/incidents/${encodeURIComponent(inc.id)}`}
      className={`row row--sev-${inc.severity}${selected ? " row--selected" : ""}`}
      aria-current={selected ? "page" : undefined}
    >
      <div className="row__line">
        <SeverityBadge severity={inc.severity} />
        <span className="mono row__ip">{inc.source_ip ?? "local"}</span>
        <OriginBadge origin={inc.origin} />
        <span className="row__spacer" />
        <span className="row__age" title={fmtUtc(inc.last_seen)}>
          {relAge(inc.last_seen, now)}
        </span>
      </div>
      <div className="row__line">
        {inc.patterns.map((p) => (
          <Chip key={p} tone={p === "success_after_failures" ? "warn" : undefined}>
            {patternLabel(p)}
          </Chip>
        ))}
      </div>
      <div className="row__line row__meta">
        <span>
          <span className="mono">{inc.failed_attempts}</span> failed
        </span>
        <span className="mono row__id">{inc.id}</span>
        <span className="row__spacer" />
        <StatusBadge status={inc.status} />
      </div>
    </Link>
  );
}
