import type { Health, Incident, IncidentDetail, ResponseAction } from "./types";

// Same-origin requests. Basic-auth credentials are handled by the browser's
// native prompt and attached automatically; nothing is stored in this code.
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export const FIXTURE_MODE = import.meta.env.DEV && import.meta.env.VITE_FIXTURES === "1";

export type ApiErrorKind = "network" | "auth" | "not_found" | "http";

export class ApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(method: "GET" | "POST", path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      signal,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("network", "API unreachable");
  }

  if (res.status === 401 || res.status === 403) throw new ApiError("auth", "Authentication required", res.status);
  if (res.status === 404) throw new ApiError("not_found", "Not found", 404);
  if (!res.ok) throw new ApiError("http", `HTTP ${res.status}`, res.status);

  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export interface Api {
  health(signal?: AbortSignal): Promise<Health>;
  incidents(signal?: AbortSignal): Promise<Incident[]>;
  incident(id: string, signal?: AbortSignal): Promise<IncidentDetail>;
  investigate(id: string): Promise<unknown>;
  approveAction(actionId: string): Promise<ResponseAction | null>;
  rejectAction(actionId: string): Promise<ResponseAction | null>;
}

const httpApi: Api = {
  health: (signal) => request("GET", "/health", signal),
  incidents: (signal) => request("GET", "/incidents", signal),
  incident: (id, signal) => request("GET", `/incidents/${encodeURIComponent(id)}`, signal),
  investigate: (id) => request("POST", `/incidents/${encodeURIComponent(id)}/investigate`),
  approveAction: (id) => request("POST", `/actions/${encodeURIComponent(id)}/approve`),
  rejectAction: (id) => request("POST", `/actions/${encodeURIComponent(id)}/reject`),
};

// Fixture module is loaded lazily and only in dev, so it never ships in a build.
let fixtureApi: Promise<Api> | null = null;
function getApi(): Promise<Api> {
  if (!FIXTURE_MODE) return Promise.resolve(httpApi);
  fixtureApi ??= import("./fixtures").then((m) => m.fixtureApi);
  return fixtureApi;
}

export const api: Api = {
  health: async (s) => (await getApi()).health(s),
  incidents: async (s) => (await getApi()).incidents(s),
  incident: async (id, s) => (await getApi()).incident(id, s),
  investigate: async (id) => (await getApi()).investigate(id),
  approveAction: async (id) => (await getApi()).approveAction(id),
  rejectAction: async (id) => (await getApi()).rejectAction(id),
};
