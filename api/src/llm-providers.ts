/** Catalog of BYO LLM providers (OpenAI-compatible chat/completions). */

export const LLM_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "custom",
] as const;

export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

export interface LlmProviderCatalogEntry {
  id: LlmProviderId;
  label: string;
  /** Default OpenAI-compatible base URL (no trailing slash). */
  baseUrl: string;
  /** Suggested model id for the placeholder / default. */
  model: string;
  /** Input placeholder for the API key field. */
  keyPlaceholder: string;
  /** Short hint shown under the key field. */
  hint: string;
}

export const LLM_PROVIDER_CATALOG: readonly LlmProviderCatalogEntry[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyPlaceholder: "sk-…",
    hint: "platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    // Anthropic’s OpenAI-compatible Messages gateway (or proxy via OpenRouter).
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-5",
    keyPlaceholder: "sk-ant-…",
    hint: "console.anthropic.com — use an OpenAI-compatible proxy if /chat/completions is required",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
    keyPlaceholder: "AIza…",
    hint: "aistudio.google.com — OpenAI-compatible endpoint",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    keyPlaceholder: "sk-or-…",
    hint: "openrouter.ai/keys — route to OpenAI, Anthropic, Gemini, etc.",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    baseUrl: "",
    model: "",
    keyPlaceholder: "API key",
    hint: "Any OpenAI-compatible /v1 chat completions endpoint",
  },
] as const;

export function isLlmProviderId(value: unknown): value is LlmProviderId {
  return typeof value === "string" && (LLM_PROVIDER_IDS as readonly string[]).includes(value);
}

export function catalogEntry(id: LlmProviderId): LlmProviderCatalogEntry {
  const found = LLM_PROVIDER_CATALOG.find((p) => p.id === id);
  return found ?? LLM_PROVIDER_CATALOG[0]!;
}
