import { useState } from "react";
import type { SentinelEvent } from "../api/types";
import { eventLabel, fmtUtc, fmtUtcMs, shortId } from "../lib/format";
import { visible } from "../lib/safeText";
import { OriginBadge } from "./Badge";
import { Username } from "./Untrusted";

interface Props {
  events: SentinelEvent[];
  citedBy: Map<string, number>;
  highlighted: string | null;
}

export function Timeline({ events, citedBy, highlighted }: Props) {
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return (
    <ol className="timeline">
      {sorted.map((e) => (
        <EventRow key={e.event_id} ev={e} cited={citedBy.get(e.event_id) ?? 0} highlighted={highlighted === e.event_id} />
      ))}
    </ol>
  );
}

function EventRow({ ev, cited, highlighted }: { ev: SentinelEvent; cited: number; highlighted: boolean }) {
  const [rawOpen, setRawOpen] = useState(false);
  const success = ev.type === "ssh_success";

  return (
    <li id={`ev-${ev.event_id}`} className={`event${success ? " event--success" : ""}${highlighted ? " event--highlight" : ""}`}>
      <div className="event__main">
        <time className="mono event__time" dateTime={ev.timestamp} title={ev.timestamp}>
          {fmtUtcMs(ev.timestamp)}
        </time>
        <span className="event__type">{eventLabel(ev.type)}</span>
        <span className="event__user">
          <Username value={ev.username} />
        </span>
        <span className="mono event__src">
          {ev.source_ip ?? "local"}
          {ev.source_port !== null && <span className="faint">:{ev.source_port}</span>}
        </span>
        <OriginBadge origin={ev.origin} />
        <span className="row__spacer" />
        {cited > 0 && (
          <span className="event__cited" title="Cited as evidence by AI findings">
            cited ×{cited}
          </span>
        )}
        <span className="mono faint event__id" title={ev.event_id}>
          {shortId(ev.event_id)}
        </span>
        <button type="button" className="link-btn" aria-expanded={rawOpen} onClick={() => setRawOpen(!rawOpen)}>
          {rawOpen ? "hide raw" : "raw"}
        </button>
      </div>
      {rawOpen && (
        <div className="event__raw">
          <div className="event__raw-label">Raw journal message · untrusted · {fmtUtc(ev.timestamp)}</div>
          <pre className="mono">{visible(ev.raw_message)}</pre>
        </div>
      )}
    </li>
  );
}
