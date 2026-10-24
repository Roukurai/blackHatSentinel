import { useState } from "react";
import { hasInvisible, visible } from "../lib/safeText";

// Renders attacker-controlled text inertly: text node only, invisible chars shown,
// long values truncated with an explicit expand.
export function UntrustedText({ value, max = 48 }: { value: string; max?: number }) {
  const [open, setOpen] = useState(false);
  const shown = visible(value);
  const long = shown.length > max;
  const flagged = hasInvisible(value);

  return (
    <span className={`untrusted${flagged ? " untrusted--flagged" : ""}`} title={flagged ? "Contains hidden or control characters" : undefined}>
      “{open || !long ? shown : shown.slice(0, max) + "…"}”
      {long && (
        <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "less" : `+${shown.length - max}`}
        </button>
      )}
    </span>
  );
}

export function Username({ value }: { value: string | null }) {
  if (value === null) return <span className="faint">—</span>;
  if (value === "")
    return (
      <span className="untrusted" title="Empty username">
        “” <span className="faint">(empty)</span>
      </span>
    );
  return <UntrustedText value={value} max={32} />;
}
