import { useEffect, useMemo, useRef, useState } from "react";
import { MOD_KEY, useModHotkey } from "../lib/hotkeys";
import { useNavigate } from "react-router-dom";
import { useIncidents } from "../api/queries";
import type { Incident } from "../api/types";
import { patternLabel, relAge, SEVERITY_LABELS, STATUS_LABELS, useNow } from "../lib/format";

// Navigation only. Actions that change the host (approving a block) are deliberately
// not reachable from here: they always go through the incident's confirmation dialog.

interface Item {
  id: string;
  group: "Go to" | "Actions" | "Incidents";
  label: string;
  hint?: string;
  mono?: boolean;
  keywords: string;
  to?: string;
  run?: () => void;
}

export { MOD_KEY };

const PAGES: Item[] = [
  { id: "nav-incidents", group: "Go to", label: "Incidents", keywords: "incidents list home", to: "/" },
  { id: "nav-health", group: "Go to", label: "Health", keywords: "health status system collector telegram ai database", to: "/health" },
  { id: "nav-setup", group: "Go to", label: "Setup", keywords: "setup onboarding install steps getting started", to: "/setup" },
  { id: "nav-ai", group: "Go to", label: "AI provider", keywords: "settings llm openai anthropic gemini openrouter api key byok model", to: "/settings/ai" },
  { id: "nav-notifications", group: "Go to", label: "Notifications", keywords: "settings telegram alerts bot", to: "/settings/notifications" },
  { id: "nav-response", group: "Go to", label: "Response", keywords: "settings block runner allowlist nftables", to: "/settings/response" },
  { id: "nav-host", group: "Go to", label: "Host & access", keywords: "settings host password auth detection thresholds", to: "/settings/host" },
];

function incidentItem(inc: Incident, now: number): Item {
  return {
    id: `inc-${inc.id}`,
    group: "Incidents",
    label: inc.source_ip ?? "local",
    mono: true,
    hint: `${inc.id} · ${SEVERITY_LABELS[inc.severity] ?? inc.severity} · ${STATUS_LABELS[inc.status] ?? inc.status} · ${relAge(inc.last_seen, now)}`,
    keywords: [inc.id, inc.source_ip, inc.severity, inc.status, inc.origin, ...inc.patterns, ...inc.patterns.map(patternLabel)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    to: `/incidents/${encodeURIComponent(inc.id)}`,
  };
}

// Every whitespace-separated term must appear somewhere in label or keywords.
function matches(item: Item, query: string): boolean {
  const hay = `${item.label} ${item.keywords}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

export function useCommandPaletteHotkey(onToggle: () => void) {
  useModHotkey("k", onToggle);
}

export function CommandPalette({ onClose, onToggleSidebar }: { onClose: () => void; onToggleSidebar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const navigate = useNavigate();
  const { data } = useIncidents();
  const now = useNow(10_000);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);

  const items = useMemo(() => {
    const incidents = [...(data ?? [])].sort((a, b) => b.last_seen.localeCompare(a.last_seen)).map((i) => incidentItem(i, now));
    const actions: Item[] = [
      { id: "act-sidebar", group: "Actions", label: "Toggle sidebar", hint: `${MOD_KEY} B`, keywords: "sidebar collapse expand menu navigation", run: onToggleSidebar },
    ];
    return [...PAGES, ...actions, ...incidents].filter((i) => matches(i, query));
  }, [data, now, query, onToggleSidebar]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    if (item.run) item.run();
    else if (item.to) navigate(item.to);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[active]);
    }
  };

  let lastGroup: string | null = null;

  return (
    <dialog
      ref={ref}
      className="cmdk"
      aria-label="Command menu"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cmdk__search">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={items[active] ? `cmdk-${items[active]!.id}` : undefined}
          placeholder="Search incidents by IP, ID, pattern, or go to a page…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        <kbd>Esc</kbd>
      </div>

      <ul className="cmdk__list" id="cmdk-list" role="listbox" ref={listRef}>
        {items.length === 0 && <li className="cmdk__empty">No results for “{query}”</li>}
        {items.map((item, i) => {
          const header = item.group !== lastGroup ? item.group : null;
          lastGroup = item.group;
          return (
            <li key={item.id} role="presentation">
              {header && <div className="cmdk__group">{header}</div>}
              <div
                id={`cmdk-${item.id}`}
                role="option"
                aria-selected={i === active}
                data-index={i}
                className={`cmdk__item${i === active ? " cmdk__item--active" : ""}`}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(item)}
              >
                <span className={item.mono ? "mono" : undefined}>{item.label}</span>
                {item.hint && <span className="cmdk__hint">{item.hint}</span>}
                {i === active && <kbd className="cmdk__enter">↵</kbd>}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="cmdk__foot">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> navigate
        </span>
        <span>
          <kbd>↵</kbd> open
        </span>
        <span className="spacer" />
        <span>
          <kbd>{MOD_KEY}</kbd> <kbd>K</kbd> toggle
        </span>
      </div>
    </dialog>
  );
}
