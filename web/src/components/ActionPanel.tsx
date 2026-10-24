import { useEffect, useRef, useState } from "react";
import { useActionDecision } from "../api/queries";
import type { ActionStatus, IncidentDetail, ResponseAction } from "../api/types";
import { fmtDuration, fmtUtc, relAge, useNow } from "../lib/format";
import { Note, StatusDot, type Tone } from "./ui";

// Everything shown here comes from backend state. Approve/reject never update
// the UI optimistically; the next poll is the only source of the outcome.

const STATUS: Record<ActionStatus, { tone: Tone; label: string; pulse?: boolean }> = {
  proposed: { tone: "amber", label: "Awaiting approval" },
  rejected_by_policy: { tone: "red", label: "Blocked by policy" },
  approved: { tone: "blue", label: "Approved, applying", pulse: true },
  applied: { tone: "blue", label: "Applied, verifying", pulse: true },
  verified: { tone: "green", label: "Applied and verified" },
  expired: { tone: "gray", label: "Expired" },
  rolled_back: { tone: "gray", label: "Rolled back" },
  failed: { tone: "red", label: "Failed" },
};

const STEPS = ["Proposed", "Approved", "Applied", "Verified", "Ended"] as const;
const STEP_INDEX: Partial<Record<ActionStatus, number>> = {
  proposed: 0,
  approved: 1,
  applied: 2,
  verified: 3,
  expired: 4,
  rolled_back: 4,
};

function sentence(s: string): string {
  return /[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`;
}

export function ActionSection({ incident }: { incident: IncidentDetail }) {
  const action = incident.action;
  if (!action) return null;
  return (
    <section className="section" aria-label="Response action">
      <header className="section-head">
        <h2 className="h-section">Response</h2>
        <span className="muted">Human-approved, temporary and reversible</span>
      </header>
      <ActionCard incident={incident} action={action} />
    </section>
  );
}

function ActionCard({ incident, action }: { incident: IncidentDetail; action: ResponseAction }) {
  const now = useNow();
  const decision = useActionDecision(incident.id);
  const [confirming, setConfirming] = useState(false);

  // The contract has no human-rejected action status; the incident status carries it.
  const operatorRejected = incident.status === "action_rejected";
  const st = operatorRejected ? { tone: "gray" as const, label: "Rejected by operator" } : STATUS[action.status] ?? { tone: "gray" as const, label: action.status };
  const canDecide = action.status === "proposed" && !operatorRejected;
  const step = operatorRejected ? -1 : STEP_INDEX[action.status];

  return (
    <div className="card action">
      <div className="action__head">
        <div>
          <div className="action__title">Temporary IP block</div>
          <div className="muted action__desc">
            Drop all traffic from <span className="mono">{action.target}</span> for {fmtDuration(action.ttl_seconds)} via the nftables
            blocklist. The block expires automatically.
          </div>
        </div>
        <StatusDot tone={st.tone} label={st.label} pulse={"pulse" in st && st.pulse} />
      </div>

      {step !== undefined && step >= 0 && (
        <ol className="steps" aria-label="Action progress">
          {STEPS.map((s, i) => (
            <li key={s} className={`step${i < step ? " step--done" : i === step ? " step--current" : ""}`}>
              <span className="step__dot" aria-hidden="true" />
              {i === 4 && step === 4 ? STATUS[action.status]?.label ?? s : s}
            </li>
          ))}
        </ol>
      )}

      <dl className="action__grid">
        <div className="field">
          <dt className="field__label">Target</dt>
          <dd className="field__value mono">{action.target}</dd>
        </div>
        <div className="field">
          <dt className="field__label">Duration</dt>
          <dd className="field__value mono">{fmtDuration(action.ttl_seconds)}</dd>
        </div>
        <div className="field">
          <dt className="field__label">Applied</dt>
          <dd className="field__value mono">{action.applied_at ? fmtUtc(action.applied_at) : "—"}</dd>
        </div>
        <div className="field">
          <dt className="field__label">Expires</dt>
          <dd className="field__value mono" title={fmtUtc(action.expires_at)}>
            {action.expires_at ? relAge(action.expires_at, now) : "—"}
          </dd>
        </div>
      </dl>

      {action.status === "rejected_by_policy" && (
        <div className="action__note">
          <Note type="error" label="Rejected by policy">
            {sentence(action.policy_reason ?? "The target is protected by the response allowlist")} Approval cannot override this.
          </Note>
        </div>
      )}
      {action.status === "failed" && (
        <div className="action__note">
          <Note type="error" label="Action failed">
            {sentence(action.policy_reason ?? "The runner did not apply the block")} No traffic is being blocked.
          </Note>
        </div>
      )}
      {decision.isError && (
        <div className="action__note">
          <Note type="error" label="Request refused">
            {decision.error.message}
          </Note>
        </div>
      )}

      {canDecide && (
        <div className="action__foot">
          <span className="muted">The server re-checks the allowlist policy on approval.</span>
          <span className="spacer" />
          <button
            type="button"
            className="g-btn g-btn--secondary"
            disabled={decision.isPending}
            onClick={() => decision.mutate({ actionId: action.id, decision: "reject" })}
          >
            Reject
          </button>
          <button type="button" className="g-btn g-btn--primary" disabled={decision.isPending} onClick={() => setConfirming(true)}>
            Approve block…
          </button>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          action={action}
          pending={decision.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            decision.mutate({ actionId: action.id, decision: "approve" }, { onSettled: () => setConfirming(false) })
          }
        />
      )}
    </div>
  );
}

function ConfirmDialog({
  action,
  pending,
  onCancel,
  onConfirm,
}: {
  action: ResponseAction;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === action.target;

  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);

  return (
    <dialog ref={ref} className="g-modal" onCancel={onCancel} aria-labelledby="confirm-title">
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (matches && !pending) onConfirm();
        }}
      >
        <div className="g-modal__body">
          <h2 id="confirm-title" className="h-section">
            Block {action.target}?
          </h2>
          <p className="muted">
            All traffic from this address will be dropped for <strong>{fmtDuration(action.ttl_seconds)}</strong>, then the block expires
            automatically. If this is a legitimate user, they will be locked out until then.
          </p>
          <Note type="warning">Make sure this is not your own, a teammate's, or the venue's IP address.</Note>
          <label className="g-modal__label" htmlFor="confirm-target">
            Type <span className="mono">{action.target}</span> to confirm
          </label>
          <div className="g-input">
            <input
              id="confirm-target"
              className="mono"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
            />
          </div>
        </div>
        <div className="g-modal__foot">
          <button type="button" className="g-btn g-btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="g-btn g-btn--primary" disabled={!matches || pending}>
            {pending ? "Approving…" : "Approve block"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
