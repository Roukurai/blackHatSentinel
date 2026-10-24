import { FIXTURE_MODE } from "../api/client";

export function FixtureBanner() {
  if (!FIXTURE_MODE) return null;
  return (
    <div className="fixture-banner" role="status">
      FIXTURE DATA — not from a live host. Local UI development only.
    </div>
  );
}
