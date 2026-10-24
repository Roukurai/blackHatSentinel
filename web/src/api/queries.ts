import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./client";

const POLL_MS = 2000;

// Stop polling a resource that does not exist or needs a login prompt.
function pollUnlessFatal(error: unknown) {
  return error instanceof ApiError && (error.kind === "not_found" || error.kind === "auth") ? false : POLL_MS;
}

export const keys = {
  health: ["health"] as const,
  incidents: ["incidents"] as const,
  incident: (id: string) => ["incident", id] as const,
};

export function useHealth() {
  return useQuery({
    queryKey: keys.health,
    queryFn: ({ signal }) => api.health(signal),
    refetchInterval: (q) => pollUnlessFatal(q.state.error),
  });
}

export function useIncidents() {
  return useQuery({
    queryKey: keys.incidents,
    queryFn: ({ signal }) => api.incidents(signal),
    refetchInterval: (q) => pollUnlessFatal(q.state.error),
  });
}

export function useIncident(id: string | undefined) {
  return useQuery({
    queryKey: keys.incident(id ?? ""),
    queryFn: ({ signal }) => api.incident(id!, signal),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    retry: (count, err) => !(err instanceof ApiError && err.kind === "not_found") && count < 1,
    refetchInterval: (q) => pollUnlessFatal(q.state.error),
  });
}

function useRefreshIncident() {
  const qc = useQueryClient();
  return (id: string) => {
    void qc.invalidateQueries({ queryKey: keys.incident(id) });
    void qc.invalidateQueries({ queryKey: keys.incidents });
  };
}

// Explicit user action only. The UI disables the trigger while pending/investigating.
export function useInvestigate(incidentId: string) {
  const refresh = useRefreshIncident();
  return useMutation({
    mutationKey: ["investigate", incidentId],
    mutationFn: () => api.investigate(incidentId),
    onSettled: () => refresh(incidentId),
  });
}

// No optimistic updates: the displayed outcome always comes from the backend.
export function useActionDecision(incidentId: string) {
  const refresh = useRefreshIncident();
  return useMutation({
    mutationKey: ["action", incidentId],
    mutationFn: ({ actionId, decision }: { actionId: string; decision: "approve" | "reject" }) =>
      decision === "approve" ? api.approveAction(actionId) : api.rejectAction(actionId),
    onSettled: () => refresh(incidentId),
  });
}
