import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, authStatus } from "./client";
import type { LlmSettingsUpdate } from "./types";

const POLL_MS = 2000;

// Stop polling a resource that does not exist or needs a login prompt.
function pollUnlessFatal(error: unknown) {
  return error instanceof ApiError && (error.kind === "not_found" || error.kind === "auth" || error.kind === "setup") ? false : POLL_MS;
}

export const keys = {
  health: ["health"] as const,
  incidents: ["incidents"] as const,
  incident: (id: string) => ["incident", id] as const,
  llmSettings: ["llmSettings"] as const,
  overview: ["settingsOverview"] as const,
  notifications: ["notifications"] as const,
};

export function useAuthStatus() {
  return useQuery({
    queryKey: ["authStatus"] as const,
    queryFn: ({ signal }) => authStatus(signal),
    retry: false,
    staleTime: 5_000,
  });
}

export function useHealth(enabled = true) {
  return useQuery({
    queryKey: keys.health,
    queryFn: ({ signal }) => api.health(signal),
    enabled,
    refetchInterval: (q) => pollUnlessFatal(q.state.error),
  });
}

export function useIncidents(enabled = true) {
  return useQuery({
    queryKey: keys.incidents,
    queryFn: ({ signal }) => api.incidents(signal),
    enabled,
    refetchInterval: (q) => pollUnlessFatal(q.state.error),
  });
}

export function useIncident(id: string | undefined) {
  return useQuery({
    queryKey: keys.incident(id ?? ""),
    queryFn: ({ signal }) => api.incident(id!, signal),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
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

export function useLlmSettings() {
  return useQuery({
    queryKey: keys.llmSettings,
    queryFn: ({ signal }) => api.llmSettings(signal),
  });
}

export function useSaveLlmSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["saveLlmSettings"],
    mutationFn: (update: LlmSettingsUpdate) => api.saveLlmSettings(update),
    onSuccess: (data) => {
      qc.setQueryData(keys.llmSettings, data);
      void qc.invalidateQueries({ queryKey: keys.health });
      void qc.invalidateQueries({ queryKey: keys.overview });
    },
  });
}

// Configuration changes on the host (env, collector) are slow; poll gently.
export function useMyNotifications() {
  return useQuery({
    queryKey: keys.notifications,
    queryFn: ({ signal }) => api.notifications(signal),
    refetchInterval: (q) => pollUnlessFatal(q.state.error) && 5000,
  });
}

export function useCreatePerson() {
  return useMutation({
    mutationKey: ["createPerson"],
    mutationFn: (input: { username: string; password: string }) => api.createPerson(input.username, input.password),
  });
}

export function useLinkTelegram() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["linkTelegram"],
    mutationFn: () => api.linkTelegram(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.notifications }),
  });
}

export function useSettingsOverview() {
  return useQuery({
    queryKey: keys.overview,
    queryFn: ({ signal }) => api.settingsOverview(signal),
    refetchInterval: (q) => pollUnlessFatal(q.state.error) && 5000,
  });
}
