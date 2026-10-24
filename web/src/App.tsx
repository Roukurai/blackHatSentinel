import { useCallback, useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useHealth, useIncidents } from "./api/queries";
import { CommandPalette, MOD_KEY, useCommandPaletteHotkey } from "./components/CommandPalette";
import { FixtureBanner } from "./components/FixtureBanner";
import { HealthIndicator, HealthPage } from "./components/Health";
import { IncidentPage } from "./components/IncidentDetail";
import { IncidentsPage } from "./components/IncidentList";
import { AiSettingsPage, HostSettingsPage, NotificationsSettingsPage, ResponseSettingsPage } from "./components/Settings";
import { SetupPage } from "./components/Setup";
import { Sidebar } from "./components/Sidebar";
import { EmptyState } from "./components/ui";
import { isNarrowViewport, useCollapsedSidebar, useModHotkey } from "./lib/hotkeys";

export function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useCollapsedSidebar();
  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);
  useCommandPaletteHotkey(togglePalette);

  // Cmd/Ctrl+B: collapse/expand the sidebar on desktop, open/close the drawer on small screens.
  const toggleSidebar = useCallback(() => {
    if (isNarrowViewport()) setNavOpen((o) => !o);
    else setCollapsed(!collapsed);
  }, [collapsed, setCollapsed]);
  useModHotkey("b", toggleSidebar);

  // Close the mobile drawer whenever the route changes.
  const { pathname } = useLocation();
  useEffect(() => setNavOpen(false), [pathname]);

  return (
    <div className="shell">
      <FixtureBanner />
      <Header onOpenPalette={() => setPaletteOpen(true)} navOpen={navOpen} onToggleNav={() => setNavOpen((o) => !o)} />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onToggleSidebar={toggleSidebar} />}
      <div className={`layout${navOpen ? " layout--nav-open" : ""}${collapsed ? " layout--collapsed" : ""}`}>
        <Sidebar collapsed={collapsed} onToggleCollapsed={toggleSidebar} />
        {navOpen && <button type="button" className="layout__scrim" aria-label="Close menu" onClick={() => setNavOpen(false)} />}
        <main className="main">
          <Routes>
            <Route path="/" element={<IncidentsPage />} />
            <Route path="/incidents/:id" element={<IncidentRoute />} />
            <Route path="/health" element={<HealthPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/settings" element={<Navigate to="/settings/ai" replace />} />
            <Route path="/settings/ai" element={<AiSettingsPage />} />
            <Route path="/settings/notifications" element={<NotificationsSettingsPage />} />
            <Route path="/settings/response" element={<ResponseSettingsPage />} />
            <Route path="/settings/host" element={<HostSettingsPage />} />
            <Route
              path="*"
              element={
                <div className="page">
                  <EmptyState title="Page not found" />
                </div>
              }
            />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function IncidentRoute() {
  const { id } = useParams();
  return <IncidentPage key={id} id={id!} />;
}

function Logo() {
  // Sentinell mark (shared with the landing page): a filled shield with a horizontal slit.
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 3.5 5.5v6c0 5 3.6 9.3 8.5 10.5 4.9-1.2 8.5-5.5 8.5-10.5v-6L12 2Z" fill="currentColor" />
      <path d="M8 12.5h8" stroke="var(--brand-background)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Header({ onOpenPalette, navOpen, onToggleNav }: { onOpenPalette: () => void; navOpen: boolean; onToggleNav: () => void }) {
  const health = useHealth();
  const incidents = useIncidents();
  const host = health.data?.host_id ?? incidents.data?.[0]?.host_id;

  return (
    <header className="header">
      <div className="header__top">
        <button
          type="button"
          className="nav-toggle"
          aria-label={navOpen ? "Close menu" : "Open menu"}
          aria-expanded={navOpen}
          aria-controls="sidebar"
          onClick={onToggleNav}
        >
          <span />
          <span />
        </button>
        <NavLink to="/" className="brand" aria-label="Sentinell home">
          <Logo />
          <span>Sentinell</span>
        </NavLink>
        <span className="slash" aria-hidden="true">
          /
        </span>
        <span className="scope">
          <span className="scope__avatar" aria-hidden="true" />
          <span className="mono">{host ?? "—"}</span>
        </span>
        <span className="spacer" />
        <button type="button" className="search-trigger" onClick={onOpenPalette} aria-label="Open command menu">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="search-trigger__label">Search…</span>
          <kbd>
            {MOD_KEY} K
          </kbd>
        </button>
        <HealthIndicator />
      </div>
    </header>
  );
}
