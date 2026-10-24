import type { Finding, FindingKind, IncidentDetail } from "../api/types";
import { useInvestigate } from "../api/queries";
import { fmtUtc, shortId } from "../lib/format";

const GROUPS: { kind: FindingKind; title: string; hint: string }[] = [
  { kind: "observed", title: "Observed", hint: "Directly shown by the cited events" },
  { kind: "suspected", title: "Suspected", hint: "Inferred; not proven by the logs" },
  { kind: "unknown", title: "Unknown", hint: "Cannot be determined from available evidence" },
];

const MITRE_ID = /^T\d{4}(\.\d{3})?$/;

interface Props {
  incident: IncidentDetail;
  loadedEventIds: Set<string>;
  onFocusEvent: (id: string) => void;
}

export function InvestigationPanel({ incident, loadedEventIds, onFocusEvent }: Props) {
  const investigate = useInvestigate(incident.id);
  const inv = incident.investigation;
  const running = incident.status === "investigating" || investigate.isPending;

  const runButton = (label: string) => (
    <button type="button" className="btn" disabled={running} onClick={() => investigate.mutate()}>
      {running ? "Investigating…" : label}
    </button>
  );

  let body;
  if (running) {
    body = (
      <div className="inv-state">
        <span className="spinner" aria-hidden="true" /> AI investigator is reviewing the evidence…
      </div>
    );
  } else if (!inv) {
    body = <div className="inv-state">Not investigated yet. Detection results above are complete without it.</div>;
  } else if (inv.status === "unavailable") {
    body = (
      <div className="inv-state">
        AI investigator unavailable. Detection and alerts are unaffected; the incident remains valid.
      </div>
    );
  } else if (inv.status === "failed") {
    body = <div className="inv-state inv-state--bad">Investigation failed. Retry, or review the timeline manually.</div>;
  } else {
    body = <Findings inv={inv} loadedEventIds={loadedEventIds} onFocusEvent={onFocusEvent} />;
  }

  return (
    <section className="panel" aria-label="AI investigation">
      <header className="panel__head">
        <h2 className="section-title">AI investigation</h2>
        <span className="row__spacer" />
        {!running && runButton(inv ? "Re-run" : "Investigate")}
      </header>
      {body}
      {investigate.isError && <div className="inv-state inv-state--bad">Request failed: {investigate.error.message}</div>}
      {inv && !running && (
        <footer className="panel__foot faint">
          {inv.model && <span className="mono">{inv.model}</span>}
          {inv.status === "ok" && <span>investigated in {(inv.duration_ms / 1000).toFixed(1)}s</span>}
          <span className="mono">{fmtUtc(inv.created_at)}</span>
        </footer>
      )}
    </section>
  );
}

function Findings({
  inv,
  loadedEventIds,
  onFocusEvent,
}: {
  inv: NonNullable<IncidentDetail["investigation"]>;
  loadedEventIds: Set<string>;
  onFocusEvent: (id: string) => void;
}) {
  return (
    <div className="findings">
      {inv.summary && <p className="inv-summary">{inv.summary}</p>}

      {GROUPS.map((g) => {
        const items = inv.findings.filter((f) => f.kind === g.kind);
        return (
          <div key={g.kind} className={`fgroup fgroup--${g.kind}`}>
            <div className="fgroup__head">
              <span className="fgroup__title">{g.title}</span>
              <span className="mono faint">{items.length}</span>
              <span className="faint fgroup__hint">{g.hint}</span>
            </div>
            {items.length === 0 ? (
              <div className="faint fgroup__empty">None reported</div>
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

      {inv.recommendation && (
        <div className="inv-reco">
          <span className="section-title">Recommendation</span>
          <p>{inv.recommendation}</p>
        </div>
      )}

      {inv.mitre.length > 0 && (
        <div className="inv-mitre">
          <span className="section-title">MITRE ATT&amp;CK</span>
          {inv.mitre.map((t) =>
            MITRE_ID.test(t) ? (
              <a
                key={t}
                className="chip mono"
                href={`https://attack.mitre.org/techniques/${t.replace(".", "/")}/`}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t}
              </a>
            ) : (
              <span key={t} className="chip mono">
                {t}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function FindingItem({
  f,
  loadedEventIds,
  onFocusEvent,
}: {
  f: Finding;
  loadedEventIds: Set<string>;
  onFocusEvent: (id: string) => void;
}) {
  const uncited = f.kind !== "unknown" && f.evidence.length === 0;
  return (
    <li className="finding">
      <p className="finding__text">{f.statement}</p>
      {(f.evidence.length > 0 || uncited) && (
        <div className="finding__evidence">
          {uncited && <span className="ev-chip ev-chip--missing">no evidence cited</span>}
          {f.evidence.map((id) =>
            loadedEventIds.has(id) ? (
              <button key={id} type="button" className="ev-chip mono" title={`Show event ${id}`} onClick={() => onFocusEvent(id)}>
                {shortId(id)}
              </button>
            ) : (
              <span key={id} className="ev-chip ev-chip--missing mono" title={`Event ${id} is not in the loaded timeline`}>
                {shortId(id)} · not in loaded events
              </span>
            ),
          )}
        </div>
      )}
    </li>
  );
}
