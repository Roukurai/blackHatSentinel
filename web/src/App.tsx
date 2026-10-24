import { Route, Routes } from "react-router-dom";
import { FixtureBanner } from "./components/FixtureBanner";

export function App() {
  return (
    <div className="shell">
      <FixtureBanner />
      <header className="topbar">
        <span className="brand">SENTINEL</span>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<p className="host">No incidents loaded yet.</p>} />
          <Route path="/incidents/:id" element={<p className="host">Incident detail</p>} />
        </Routes>
      </main>
    </div>
  );
}
