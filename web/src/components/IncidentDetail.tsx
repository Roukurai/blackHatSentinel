import { useIncident } from "../api/queries";
import { ErrorState, SkeletonRows } from "./StateView";

// Placeholder; full investigation view lands in the next task.
export function IncidentDetail({ id }: { id: string }) {
  const { data, error, isPending, isError } = useIncident(id);

  if (isPending) return <SkeletonRows count={3} />;
  if (isError && !data) return <ErrorState error={error} what="Incident" />;
  if (!data) return null;

  return (
    <article className="detail">
      <h1 className="detail__title mono">{data.id}</h1>
    </article>
  );
}
