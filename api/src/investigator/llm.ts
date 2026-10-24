import type { LlmConfig } from "./types.ts";

export class LlmUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmUnavailableError";
  }
}

export class LlmFailedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmFailedError";
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionResult {
  message: ChatMessage;
  finish_reason: string | null;
}

export interface ChatOpts {
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
  response_format?: { type: "json_object" };
  temperature?: number;
  /** Remaining budget in ms for this request */
  timeoutMs: number;
}

function classifyHttp(status: number): "unavailable" | "failed" {
  if (status === 408 || status === 429 || status >= 500) return "unavailable";
  return "failed";
}

export async function chat(
  cfg: LlmConfig,
  messages: ChatMessage[],
  opts: ChatOpts,
): Promise<ChatCompletionResult> {
  if (!cfg.configured) {
    throw new LlmUnavailableError("LLM not configured");
  }

  const fetchFn = cfg.fetch ?? globalThis.fetch;
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: opts.temperature ?? 0,
  };
  if (opts.tools?.length) body.tools = opts.tools;
  if (opts.tool_choice !== undefined) body.tool_choice = opts.tool_choice;
  if (opts.response_format) body.response_format = opts.response_format;

  let bodyJson: string;
  try {
    bodyJson = JSON.stringify(body);
  } catch (err) {
    throw new LlmFailedError("LLM request body not serializable", { cause: err });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  let res: Response;
  try {
    res = await fetchFn(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: bodyJson,
      signal: controller.signal,
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (
      name === "TimeoutError" ||
      name === "AbortError" ||
      controller.signal.aborted
    ) {
      throw new LlmUnavailableError("LLM request timed out", { cause: err });
    }
    throw new LlmUnavailableError("LLM network error", { cause: err });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const kind = classifyHttp(res.status);
    const msg = `LLM HTTP ${res.status}`;
    if (kind === "unavailable") throw new LlmUnavailableError(msg);
    throw new LlmFailedError(msg);
  }

  let data: {
    choices?: Array<{ message?: ChatMessage; finish_reason?: string | null }>;
  };
  try {
    data = (await res.json()) as typeof data;
  } catch (err) {
    throw new LlmFailedError("LLM response was not JSON", { cause: err });
  }

  const choice = data.choices?.[0];
  if (!choice?.message) {
    throw new LlmFailedError("LLM response missing choices");
  }

  return {
    message: choice.message,
    finish_reason: choice.finish_reason ?? null,
  };
}

export async function probeModels(cfg: LlmConfig, timeoutMs = 5000): Promise<boolean> {
  if (!cfg.configured) return false;
  const fetchFn = cfg.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${cfg.baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
