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

const FAILURE_TYPES = new Set(["ssh_invalid_user", "ssh_preauth_disconnect", "ssh_failed_password"]);

export function Timeline({ events, citedBy, highlighted }: Props) {
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return (
    <div className="logs">
      <div className="logs__bar">
        <span>Time (UTC)</span>
        <span>Event</span>
        <span>Username · Source</span>
      </div>
      <ol className="logs__list">
        {sorted.map((e) => (
          <EventRow key={e.event_id} ev={e} cited={citedBy.get(e.event_id) ?? 0} highlighted={highlighted === e.event_id} />
        ))}
      </ol>
    </div>
  );
}

function EventRow({ ev, cited, highlighted }: { ev: SentinelEvent; cited: number; highlighted: boolean }) {
  const [rawOpen, setRawOpen] = useState(false);
  const kind = ev.type === "ssh_success" ? "success" : FAILURE_TYPES.has(ev.type) ? "failure" : "other";

  return (
    <li id={`ev-${ev.event_id}`} className={`log log--${kind}${highlighted ? " log--highlight" : ""}`}>
      <div className="log__main">
        <time className="log__time" dateTime={ev.timestamp} title={fmtUtc(ev.timestamp)}>
          {fmtUtcMs(ev.timestamp)}
        </time>
        <span className="log__type">{eventLabel(ev.type)}</span>
        <span className="log__msg">
          <Username value={ev.username} />
          <span className="log__src">
            {ev.source_ip ?? "local"}
            {ev.source_port !== null && <span className="log__port">:{ev.source_port}</span>}
          </span>
          <OriginBadge origin={ev.origin} />
        </span>
        <span className="log__meta">
          {cited > 0 && (
            <span className="log__cited" title="Cited as evidence by AI findings">
              cited ×{cited}
            </span>
          )}
          <span className="log__id" title={ev.event_id}>
            {shortId(ev.event_id)}
          </span>
          <button type="button" className="log__raw-btn" aria-expanded={rawOpen} onClick={() => setRawOpen(!rawOpen)}>
            {rawOpen ? "hide" : "raw"}
          </button>
        </span>
      </div>
      {rawOpen && (
        <div className="log__raw">
          <div className="log__raw-label">Raw journal message · untrusted</div>
          <pre>{visible(ev.raw_message)}</pre>
        </div>
      )}
    </li>
  );
}
