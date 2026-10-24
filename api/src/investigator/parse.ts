import { z } from "zod";
import type { ChatMessage } from "./llm.js";
import { chat, LlmFailedError } from "./llm.js";
import type { LlmConfig, ModelOutput } from "./types.js";

const findingSchema = z.object({
  kind: z.enum(["observed", "suspected", "unknown"]),
  statement: z.string(),
  evidence: z.array(z.string()).default([]),
});

export const modelOutputSchema = z.object({
  summary: z.string(),
  findings: z.array(findingSchema).max(8),
  recommendation: z.string(),
  mitre: z.array(z.string()).default([]),
});

export function extractJsonObject(text: string): string {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new LlmFailedError("No JSON object in model output");
  }
  return t.slice(start, end + 1);
}

export function parseModelOutput(text: string): ModelOutput {
  const raw = extractJsonObject(text);
  const parsed = JSON.parse(raw) as unknown;
  return modelOutputSchema.parse(parsed);
}

export async function parseWithRepair(
  cfg: LlmConfig,
  messages: ChatMessage[],
  content: string,
  timeoutMs: number,
): Promise<ModelOutput> {
  try {
    return parseModelOutput(content);
  } catch {
    // one repair attempt
  }

  const repairMessages: ChatMessage[] = [
    ...messages,
    { role: "assistant", content },
    {
      role: "user",
      content:
        'Return only valid JSON matching {"summary":"","findings":[{"kind":"","statement":"","evidence":[]}],"recommendation":"","mitre":[]}',
    },
  ];

  const repaired = await chat(cfg, repairMessages, {
    tool_choice: "none",
    response_format: { type: "json_object" },
    timeoutMs,
  });

  const text = repaired.message.content ?? "";
  try {
    return parseModelOutput(text);
  } catch (err) {
    throw new LlmFailedError("Invalid JSON after repair", { cause: err });
  }
}
