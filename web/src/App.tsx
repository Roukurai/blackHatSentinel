import { Link, Route, Routes, useParams } from "react-router-dom";
import { useHealth, useIncidents } from "./api/queries";
import { FixtureBanner } from "./components/FixtureBanner";
import { HealthStrip } from "./components/HealthStrip";
import { IncidentDetail } from "./components/IncidentDetail";
import { IncidentList } from "./components/IncidentList";
import { StateView } from "./components/StateView";

export function App() {
  return (
    <div className="shell">
      <FixtureBanner />
      <header className="topbar">
        <Link to="/" className="brand">
          SENTINEL
        </Link>
        <HostName />
        <HealthStrip />
      </header>
      <Routes>
        <Route path="/" element={<Workspace />} />
        <Route path="/incidents/:id" element={<Workspace />} />
        <Route path="*" element={<StateView title="Page not found" />} />
      </Routes>
    </div>
  );
}

function HostName() {
  const health = useHealth();
  const incidents = useIncidents();
  const host = health.data?.host_id ?? incidents.data?.[0]?.host_id;
  return <span className="host mono">{host ?? "—"}</span>;
}

function Workspace() {
  const { id } = useParams();
  return (
    <main className={`workspace${id ? " workspace--has-detail" : ""}`}>
      <IncidentList selectedId={id} />
      <section className="workspace__detail" aria-label="Incident detail">
        {id ? (
          <>
            <Link to="/" className="back-link">
              ← All incidents
            </Link>
            <IncidentDetail key={id} id={id} />
          </>
        ) : (
          <StateView title="Select an incident">Choose an incident to see its timeline, evidence and investigation.</StateView>
        )}
      </section>
    </main>
  );
}
