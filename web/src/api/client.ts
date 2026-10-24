import type {
  Health,
  Incident,
  IncidentDetail,
  LlmSettings,
  LlmSettingsUpdate,
  ResponseAction,
} from "./types";

// Same-origin requests. Basic-auth credentials are handled by the browser's
// native prompt and attached automatically; nothing is stored in this code.
// The API serves JSON at the root; set VITE_API_BASE only if it moves under a prefix.
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

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

async function errorReason(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object") {
      for (const key of ["policy_reason", "reason", "error", "message"]) {
        const v = (body as Record<string, unknown>)[key];
        if (typeof v === "string" && v) return v.slice(0, 200);
      }
    }
  } catch {
    // not JSON
  }
  return null;
}

async function request<T>(
  method: "GET" | "POST" | "PUT",
  path: string,
  signal?: AbortSignal,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      signal,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("network", "API unreachable");
  }

  if (res.status === 401) throw new ApiError("auth", "Authentication required", 401);
  if (res.status === 404) throw new ApiError("not_found", "Not found", 404);
  // 403/409/422 may carry a reason, e.g. a policy rejection on approve. Rendered as text only.
  if (!res.ok) throw new ApiError("http", (await errorReason(res)) ?? `HTTP ${res.status}`, res.status);

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
  llmSettings(signal?: AbortSignal): Promise<LlmSettings>;
  saveLlmSettings(update: LlmSettingsUpdate): Promise<LlmSettings>;
}

const httpApi: Api = {
  health: (signal) => request("GET", "/health", signal),
  incidents: (signal) => request("GET", "/incidents", signal),
  incident: (id, signal) => request("GET", `/incidents/${encodeURIComponent(id)}`, signal),
  investigate: (id) => request("POST", `/incidents/${encodeURIComponent(id)}/investigate`),
  approveAction: (id) => request("POST", `/actions/${encodeURIComponent(id)}/approve`),
  rejectAction: (id) => request("POST", `/actions/${encodeURIComponent(id)}/reject`),
  llmSettings: (signal) => request("GET", "/settings/llm", signal),
  saveLlmSettings: (update) => request("PUT", "/settings/llm", undefined, update),
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
  llmSettings: async (s) => (await getApi()).llmSettings(s),
  saveLlmSettings: async (u) => (await getApi()).saveLlmSettings(u),
};
