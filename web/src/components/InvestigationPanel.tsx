import type { Finding, FindingKind, IncidentDetail, Investigation } from "../api/types";
import { ApiError } from "../api/client";
import { useInvestigate } from "../api/queries";
import { fmtUtc, shortId } from "../lib/format";
import { GBadge, Note, Spinner, type Tone } from "./ui";

const GROUPS: { kind: FindingKind; title: string; hint: string; tone: Tone }[] = [
  { kind: "observed", title: "Observed", hint: "Directly shown by the cited events", tone: "green" },
  { kind: "suspected", title: "Suspected", hint: "Inferred; not proven by the logs", tone: "amber" },
  { kind: "unknown", title: "Unknown", hint: "Cannot be determined from available evidence", tone: "gray" },
];

const MITRE_ID = /^T\d{4}(\.\d{3})?$/;

interface Props {
  incident: IncidentDetail;
  loadedEventIds: Set<string>;
  onFocusEvent: (id: string) => void;
}

export function InvestigationSection({ incident, loadedEventIds, onFocusEvent }: Props) {
  const investigate = useInvestigate(incident.id);
  const inv = incident.investigation;
  const running = incident.status === "investigating" || investigate.isPending;

  let body;
  if (running) {
    body = (
      <div className="card inv-state">
        <Spinner /> AI investigator is reviewing the evidence…
      </div>
    );
  } else if (!inv) {
    body = <div className="card inv-state">Not investigated yet. The detection results above are complete without it.</div>;
  } else if (inv.status === "unavailable") {
    body = (
      <Note label="AI unavailable">The investigator could not run. Detection and alerts are unaffected; this incident remains valid.</Note>
    );
  } else if (inv.status === "failed") {
    body = (
      <Note type="error" label="Investigation failed">
        Retry, or review the events below manually.
      </Note>
    );
  } else {
    body = <Findings inv={inv} loadedEventIds={loadedEventIds} onFocusEvent={onFocusEvent} />;
  }

  return (
    <section className="section" aria-label="AI investigation">
      <header className="section-head">
        <h2 className="h-section">Investigation</h2>
        {inv && !running && (
          <span className="muted section-head__meta">
            {inv.model && <span className="mono">{inv.model}</span>}
            {inv.status === "ok" && <span>investigated in {(inv.duration_ms / 1000).toFixed(1)}s</span>}
            <span className="mono">{fmtUtc(inv.created_at)}</span>
          </span>
        )}
        <span className="spacer" />
        <button type="button" className="g-btn g-btn--secondary g-btn--sm" disabled={running} onClick={() => investigate.mutate()}>
          {running ? "Investigating…" : inv ? "Re-run" : "Investigate"}
        </button>
      </header>
      {body}
      {investigate.isError &&
        (investigate.error instanceof ApiError && investigate.error.kind === "not_found" && !incident.investigation ? (
          <Note label="Not available yet">This API does not expose on-demand investigation. Detection and alerts are unaffected.</Note>
        ) : (
          <Note type="error" label="Request failed">
            {investigate.error.message}
          </Note>
        ))}
    </section>
  );
}

function Findings({ inv, loadedEventIds, onFocusEvent }: { inv: Investigation; loadedEventIds: Set<string>; onFocusEvent: (id: string) => void }) {
  return (
    <div className="card findings">
      {inv.summary && <p className="inv-summary">{inv.summary}</p>}

      {GROUPS.map((g) => {
        const items = inv.findings.filter((f) => f.kind === g.kind);
        return (
          <div key={g.kind} className="fgroup">
            <div className="fgroup__head">
              <GBadge tone={g.tone}>
                {g.title} · {items.length}
              </GBadge>
              <span className="muted fgroup__hint">{g.hint}</span>
            </div>
            {items.length === 0 ? (
              <div className="muted fgroup__empty">None reported</div>
            ) : (
              <ul className="fgroup__list">
                {items.map((f, i) => (
                  <FindingItem key={i} f={f} loadedEventIds={loadedEventIds} onFocusEvent={onFocusEvent} />
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {(inv.recommendation || inv.mitre.length > 0) && (
        <div className="findings__foot">
          {inv.recommendation && (
            <div>
              <div className="label">Recommendation</div>
              <p className="inv-reco">{inv.recommendation}</p>
            </div>
          )}
          {inv.mitre.length > 0 && (
            <div>
              <div className="label">MITRE ATT&amp;CK</div>
              <span className="badges">
                {inv.mitre.map((t) =>
                  MITRE_ID.test(t) ? (
                    <a
                      key={t}
                      className="g-badge g-badge--gray g-badge--mono g-badge--link"
                      href={`https://attack.mitre.org/techniques/${t.replace(".", "/")}/`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {t} ↗
                    </a>
                  ) : (
                    <GBadge key={t} mono>
                      {t}
                    </GBadge>
                  ),
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FindingItem({ f, loadedEventIds, onFocusEvent }: { f: Finding; loadedEventIds: Set<string>; onFocusEvent: (id: string) => void }) {
  const uncited = f.kind !== "unknown" && f.evidence.length === 0;
  return (
    <li className="finding">
      <p className="finding__text">{f.statement}</p>
      {(f.evidence.length > 0 || uncited) && (
        <div className="finding__evidence">
          {uncited && <span className="ev-chip ev-chip--missing">no evidence cited</span>}
          {f.evidence.map((id) =>
            loadedEventIds.has(id) ? (
              <button key={id} type="button" className="ev-chip" title={`Show event ${id}`} onClick={() => onFocusEvent(id)}>
                {shortId(id)}
              </button>
            ) : (
              <span key={id} className="ev-chip ev-chip--missing" title={`Event ${id} is not in the loaded timeline`}>
                {shortId(id)} · not in loaded events
              </span>
            ),
          )}
        </div>
      )}
    </li>
  );
}
