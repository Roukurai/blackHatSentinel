// Geist-style primitives. Domain meaning lives in Badge.tsx; these only know visuals.
import type { ReactNode } from "react";

export type Tone = "gray" | "blue" | "red" | "amber" | "green" | "purple";

export function GBadge({ tone = "gray", children, title, mono }: { tone?: Tone; children: ReactNode; title?: string; mono?: boolean }) {
  return (
    <span className={`g-badge g-badge--${tone}${mono ? " g-badge--mono" : ""}`} title={title}>
      {children}
    </span>
  );
}

export function StatusDot({ tone, label, pulse }: { tone: Tone; label?: ReactNode; pulse?: boolean }) {
  return (
    <span className="g-status">
      <span className={`g-dot g-dot--${tone}${pulse ? " g-dot--pulse" : ""}`} aria-hidden="true" />
      {label && <span className="g-status__label">{label}</span>}
    </span>
  );
}

type NoteType = "default" | "warning" | "error" | "success";
const NOTE_LABEL: Record<NoteType, string> = { default: "Note", warning: "Warning", error: "Error", success: "Success" };

export function Note({ type = "default", label, children }: { type?: NoteType; label?: string | false; children: ReactNode }) {
  return (
    <div className={`g-note g-note--${type}`} role={type === "error" ? "alert" : "note"}>
      {label !== false && <strong className="g-note__label">{label ?? NOTE_LABEL[type]}:</strong>} {children}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span className="g-spinner" style={{ width: size, height: size }} aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} style={{ transform: `rotate(${i * 30}deg) translate(146%)`, animationDelay: `${-1.2 + i * 0.1}s` }} />
      ))}
    </span>
  );
}

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: number | string }) {
  return <span className="g-skeleton" style={{ height, width }} aria-hidden="true" />;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="g-empty" role="status">
      <div className="g-empty__title">{title}</div>
      {children && <div className="g-empty__body">{children}</div>}
      {action}
    </div>
  );
}
