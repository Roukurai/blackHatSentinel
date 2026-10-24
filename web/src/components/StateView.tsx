import type { ReactNode } from "react";
import { ApiError } from "../api/client";

type Tone = "neutral" | "bad" | "warn";

export function StateView({ title, children, tone = "neutral" }: { title: string; children?: ReactNode; tone?: Tone }) {
  return (
    <div className={`state state--${tone}`} role={tone === "bad" ? "alert" : "status"}>
      <div className="state__title">{title}</div>
      {children && <div className="state__body">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, what }: { error: unknown; what: string }) {
  if (error instanceof ApiError) {
    if (error.kind === "auth")
      return (
        <StateView tone="warn" title="Authentication required">
          Reload the page to sign in.
        </StateView>
      );
    if (error.kind === "not_found") return <StateView title={`${what} not found`} />;
    if (error.kind === "network")
      return (
        <StateView tone="bad" title="API unreachable">
          Retrying automatically.
        </StateView>
      );
  }
  return (
    <StateView tone="bad" title={`Could not load ${what.toLowerCase()}`}>
      {error instanceof Error ? error.message : "Unknown error"}. Retrying automatically.
    </StateView>
  );
}

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  );
}
