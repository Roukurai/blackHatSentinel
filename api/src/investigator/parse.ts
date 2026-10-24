import { z } from "zod";
import type { ChatMessage } from "./llm.ts";
import { chat, LlmFailedError } from "./llm.ts";
import type { LlmConfig, ModelOutput } from "./types.ts";

const findingSchema = z.object({
  kind: z.enum(["observed", "suspected", "unknown"]),
  statement: z.string(),
  evidence: z.array(z.string()).default([]),
});

const rootCauseSchema = z.object({
  kind: z.enum(["observed", "suspected", "unknown"]),
  statement: z.string(),
  evidence: z.array(z.string()).default([]),
});

const blockActionSchema = z
  .object({
    kind: z.literal("block_ip"),
    target: z.string(),
  })
  .nullish();

const remediationStepSchema = z.object({
  order: z.number().int().optional(),
  text: z.string(),
  urgency: z
    .string()
    .transform((v) => v.toLowerCase())
    .pipe(z.enum(["low", "medium", "high"]))
    .catch("medium"),
  mode: z
    .string()
    .transform((v) => v.toLowerCase())
    .pipe(z.enum(["manual", "automatable"]))
    .catch("manual"),
  action: blockActionSchema.transform((a) => a ?? undefined),
});

const mitreIdSchema = z.union([
  z.string(),
  z.object({ id: z.string() }).transform((o) => o.id),
]);

export const modelOutputSchema = z.object({
  summary: z.string(),
  findings: z.array(findingSchema).max(8),
  recommendation: z.string().default(""),
  root_cause: rootCauseSchema.nullish().transform((v) => v ?? undefined),
  remediation: z
    .array(remediationStepSchema)
    .max(5)
    .nullish()
    .transform((v) => v ?? undefined),
  mitre: z.array(mitreIdSchema).default([]),
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
        'Return only valid JSON matching {"summary":"","findings":[{"kind":"","statement":"","evidence":[]}],"recommendation":"","root_cause":{"kind":"","statement":"","evidence":[]},"remediation":[{"order":1,"text":"","urgency":"medium","mode":"manual"}],"mitre":[]}',
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
