import { ApiError } from "../api/client";
import { EmptyState, Note, Skeleton } from "./ui";

export function ErrorState({ error, what }: { error: unknown; what: string }) {
  if (error instanceof ApiError) {
    if (error.kind === "auth")
      return (
        <Note type="warning" label="Authentication required">
          Reload the page to sign in.
        </Note>
      );
    if (error.kind === "not_found") return <EmptyState title={`${what} not found`}>It may have been removed, or the link is wrong.</EmptyState>;
    if (error.kind === "network")
      return (
        <Note type="error" label="API unreachable">
          Retrying automatically.
        </Note>
      );
  }
  return (
    <Note type="error" label={`Could not load ${what.toLowerCase()}`}>
      {error instanceof Error ? error.message : "Unknown error"}. Retrying automatically.
    </Note>
  );
}

export function SkeletonRows({ count = 5, height = 64 }: { count?: number; height?: number }) {
  return (
    <div className="skeleton-rows" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </div>
  );
}
