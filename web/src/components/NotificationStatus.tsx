import type { Notification } from "../api/types";
import { fmtUtc, relAge, useNow } from "../lib/format";

const TONE = { sent: "ok", pending: "neutral", failed: "bad" } as const;
const LABEL = { sent: "Delivered", pending: "Pending", failed: "Failed" } as const;

export function NotificationStatus({ n }: { n: Notification }) {
  const now = useNow();
  return (
    <section className="panel" aria-label="Telegram notification">
      <header className="panel__head">
        <h2 className="section-title">Telegram alert</h2>
      </header>
      <div className="notif">
        <span className={`dot dot--${TONE[n.status] ?? "neutral"}`} aria-hidden="true" />
        <span className="notif__status">{LABEL[n.status] ?? n.status}</span>
      </div>
      <dl className="kv kv--compact">
        <dt>Attempts</dt>
        <dd className="mono">{n.attempts}</dd>
        <dt>Last attempt</dt>
        <dd className="mono" title={fmtUtc(n.last_attempt_at)}>
          {n.last_attempt_at ? relAge(n.last_attempt_at, now) : "—"}
        </dd>
      </dl>
      {n.status === "failed" && <p className="faint notif__note">Detection is unaffected. Delivery failure is logged by the API.</p>}
    </section>
  );
}
