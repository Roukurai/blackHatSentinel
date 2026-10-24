import { NavLink, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useHealth, useIncidents } from "./api/queries";
import { FixtureBanner } from "./components/FixtureBanner";
import { HealthIndicator, HealthPage } from "./components/Health";
import { IncidentPage } from "./components/IncidentDetail";
import { IncidentsPage } from "./components/IncidentList";
import { EmptyState } from "./components/ui";

export function App() {
  return (
    <div className="shell">
      <div className="guides" aria-hidden="true" />
      <FixtureBanner />
      <Header />
      <main className="main">
        <Routes>
          <Route path="/" element={<IncidentsPage />} />
          <Route path="/incidents/:id" element={<IncidentRoute />} />
          <Route path="/health" element={<HealthPage />} />
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

function Header() {
  const health = useHealth();
  const incidents = useIncidents();
  const host = health.data?.host_id ?? incidents.data?.[0]?.host_id;
  const { pathname } = useLocation();
  const onIncidents = pathname === "/" || pathname.startsWith("/incidents");

  return (
    <header className="header">
      <div className="header__top">
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
        <HealthIndicator />
      </div>
      <nav className="tabs" aria-label="Sections">
        <NavLink to="/" className={() => `tab${onIncidents ? " tab--active" : ""}`}>
          Incidents
        </NavLink>
        <NavLink to="/health" className={({ isActive }) => `tab${isActive ? " tab--active" : ""}`}>
          Health
        </NavLink>
      </nav>
    </header>
  );
}
