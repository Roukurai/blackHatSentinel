import type { LlmConfig } from "./types.js";

const DEFAULT_TIMEOUT = 30;

export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const baseUrl = (env.LLM_BASE_URL?.trim() || "").replace(/\/$/, "");
  const apiKey = env.LLM_API_KEY?.trim() ?? "";
  const model = env.LLM_MODEL?.trim() ?? "";
  const timeoutRaw = Number(env.LLM_TIMEOUT_SECONDS ?? DEFAULT_TIMEOUT);
  const timeoutSeconds =
    Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT;

  return {
    baseUrl,
    apiKey,
    model,
    timeoutSeconds,
    configured: Boolean(baseUrl && apiKey && model),
  };
}
