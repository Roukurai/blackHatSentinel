import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useHealth, useLlmSettings, useSettingsOverview } from "../api/queries";
import { useSetupProgress } from "./Setup";
import { StatusDot, type Tone } from "./ui";

function Icon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS = {
  incidents: "M2.5 4h11M2.5 8h11M2.5 12h7",
  health: "M1.5 8h3l2-4.5 3 9 2-4.5h3",
  setup: "M3 8.5 6 11.5 13 4.5",
  ai: "M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M4.5 4.5l1.4 1.4M10.1 10.1l1.4 1.4M4.5 11.5l1.4-1.4M10.1 5.9l1.4-1.4",
  notifications: "M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3L4 11ZM6.5 14h3",
  response: "M8 1.5 2.5 3.8v3.9c0 3.3 2.3 6 5.5 6.8 3.2-.8 5.5-3.5 5.5-6.8V3.8L8 1.5ZM5.5 8h5",
  host: "M2.5 3h11v6h-11zM5 12.5h6M8 9v3.5",
};

function Item({ to, icon, label, end, trailing }: { to: string; icon: keyof typeof ICONS; label: string; end?: boolean; trailing?: ReactNode }) {
  return (
    <NavLink to={to} end={end} title={label} className={({ isActive }) => `side-item${isActive ? " side-item--active" : ""}`}>
      <Icon d={ICONS[icon]} />
      <span className="side-item__label">{label}</span>
      {trailing}
    </NavLink>
  );
}

function Dot({ tone, title }: { tone: Tone; title: string }) {
  return (
    <span className="side-item__dot" title={title}>
      <StatusDot tone={tone} />
    </span>
  );
}

export function Sidebar() {
  const { pathname } = useLocation();
  const progress = useSetupProgress();
  const health = useHealth();
  const llm = useLlmSettings();
  const overview = useSettingsOverview();
  const onIncidents = pathname === "/" || pathname.startsWith("/incidents");

  const llmTone: Tone = !llm.data?.configured ? "gray" : health.data?.llm === "ok" ? "green" : "amber";
  const telegramTone: Tone = !overview.data?.telegram.configured ? "gray" : health.data?.telegram === "ok" ? "green" : "red";
  const runnerTone: Tone = overview.data?.response.runner_configured ? "green" : "gray";
  const authTone: Tone = overview.data?.dashboard_auth ? "green" : "amber";

  return (
    <aside className="sidebar" id="sidebar" aria-label="Navigation">
      <nav className="sidebar__nav">
        <div className="side-group">
          <div className="side-group__label">Monitor</div>
          <NavLink to="/" title="Incidents" className={() => `side-item${onIncidents ? " side-item--active" : ""}`}>
            <Icon d={ICONS.incidents} />
            <span className="side-item__label">Incidents</span>
          </NavLink>
          <Item to="/health" icon="health" label="Health" />
        </div>

        <div className="side-group">
          <div className="side-group__label">Configure</div>
          <Item
            to="/setup"
            icon="setup"
            label="Setup"
            trailing={
              progress && (
                <span className={`side-item__count${progress.complete ? " side-item__count--done" : ""}`}>
                  {progress.done}/{progress.total}
                </span>
              )
            }
          />
          <Item to="/settings/ai" icon="ai" label="AI provider" trailing={<Dot tone={llmTone} title="AI provider" />} />
          <Item to="/settings/notifications" icon="notifications" label="Notifications" trailing={<Dot tone={telegramTone} title="Telegram" />} />
          <Item to="/settings/response" icon="response" label="Response" trailing={<Dot tone={runnerTone} title="Response runner" />} />
          <Item to="/settings/host" icon="host" label="Host & access" trailing={<Dot tone={authTone} title="Dashboard access" />} />
        </div>
      </nav>

      <div className="sidebar__foot">
        <div className="sidebar__hostcard" title={overview.data?.host_id || undefined}>
          <span className="scope__avatar" aria-hidden="true" />
          <span className="sidebar__host">
            <span className="mono">{overview.data?.host_id || health.data?.host_id || "—"}</span>
            <span className="muted">{overview.data?.dashboard_auth ? "Password protected" : "Localhost only"}</span>
          </span>
        </div>
      </div>
    </aside>
  );
}
