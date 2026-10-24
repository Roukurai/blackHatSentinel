import {
  fallbackRemediation,
  fallbackRootCause,
  fallbackSummary,
} from "./fallback.ts";
import {
  chat,
  LlmFailedError,
  LlmUnavailableError,
  type ChatMessage,
} from "./llm.ts";
import { parseWithRepair } from "./parse.ts";
import { buildUserMessage, SYSTEM_PROMPT } from "./prompt.ts";
import {
  executeTool,
  prefetchIncidentEvents,
  TOOL_DEFINITIONS,
  type ToolContext,
} from "./tools.ts";
import type {
  Incident,
  Investigation,
  InvestigatorDeps,
  LlmConfig,
  SentinelEvent,
} from "./types.ts";
import { validateModelOutput } from "./validate.ts";
import type { HealthTracker } from "./health.ts";

const MAX_TOOL_ROUNDS = 4;

function nonOk(
  status: "unavailable" | "failed",
  incident: Incident | null,
  model: string,
  duration_ms: number,
): Investigation {
  const summary = incident
    ? fallbackSummary(incident, "AI investigation unavailable")
    : "AI investigation unavailable: incident not found.";
  return {
    status,
    summary,
    findings: [],
    recommendation: incident
      ? "Review cited patterns manually; AI was unavailable."
      : "",
    root_cause: incident
      ? fallbackRootCause(incident)
      : {
          kind: "unknown",
          statement: "Incident not found; root cause unavailable.",
          evidence: [],
        },
    remediation: incident ? fallbackRemediation(incident) : [],
    mitre: [],
    model,
    duration_ms,
    created_at: new Date().toISOString(),
  };
}

export async function runInvestigation(
  deps: InvestigatorDeps,
  cfg: LlmConfig,
  health: HealthTracker,
  incidentId: string,
): Promise<Investigation> {
  const t0 = performance.now();
  const modelLabel = cfg.configured ? cfg.model : "none";
  const deadline = t0 + cfg.timeoutSeconds * 1000;

  const remaining = () => Math.max(100, deadline - performance.now());

  if (!cfg.configured) {
    const incident = await deps.getIncident(incidentId);
    return nonOk("unavailable", incident, "none", Math.round(performance.now() - t0));
  }

  const seenEventIds = new Set<string>();
  let incident: Incident | null = null;
  let events: SentinelEvent[] = [];

  try {
    const ctx: ToolContext = {
      deps,
      incidentId,
      seenEventIds,
      hostIdFallback: process.env.HOST_ID?.trim() || "ubuntu-01",
    };

    const pre = await prefetchIncidentEvents(ctx);
    if ("error" in pre) {
      return nonOk("failed", null, modelLabel, Math.round(performance.now() - t0));
    }
    incident = pre.incident;
    events = await deps.getEventsByIds(incident.event_ids);

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(incident) },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "prefetch_incident_events",
            type: "function",
            function: {
              name: "get_incident_events",
              arguments: JSON.stringify({ incident_id: incidentId }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "prefetch_incident_events",
        name: "get_incident_events",
        content: JSON.stringify(pre.payload),
      },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const isLast = round === MAX_TOOL_ROUNDS - 1;
      const result = await chat(cfg, messages, {
        tools: TOOL_DEFINITIONS,
        tool_choice: isLast ? "none" : "auto",
        response_format: isLast ? { type: "json_object" } : undefined,
        timeoutMs: remaining(),
      });

      const msg = result.message;
      messages.push({
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: msg.tool_calls,
      });

      const calls = msg.tool_calls ?? [];
      if (!calls.length) {
        const output = await parseWithRepair(
          cfg,
          messages,
          msg.content ?? "",
          remaining(),
        );
        const validated = validateModelOutput(
          output,
          incident,
          seenEventIds,
          events,
        );
        if (validated.rejected_findings > 0) {
          console.warn(
            `[investigator] rejected_findings=${validated.rejected_findings} incident=${incidentId}`,
          );
        }
        health.markOk();
        return {
          status: "ok",
          summary: validated.summary,
          findings: validated.findings,
          recommendation: validated.recommendation,
          root_cause: validated.root_cause,
          remediation: validated.remediation,
          mitre: validated.mitre,
          model: modelLabel,
          duration_ms: Math.round(performance.now() - t0),
          created_at: new Date().toISOString(),
        };
      }

      for (const call of calls) {
        const toolResult = await executeTool(
          ctx,
          call.function.name,
          call.function.arguments,
        );
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(toolResult),
        });
      }
    }

    // Exhausted rounds without final JSON — force one json-only call
    const final = await chat(cfg, messages, {
      tool_choice: "none",
      response_format: { type: "json_object" },
      timeoutMs: remaining(),
    });
    const output = await parseWithRepair(
      cfg,
      messages,
      final.message.content ?? "",
      remaining(),
    );
    const validated = validateModelOutput(
      output,
      incident,
      seenEventIds,
      events,
    );
    health.markOk();
    return {
      status: "ok",
      summary: validated.summary,
      findings: validated.findings,
      recommendation: validated.recommendation,
      root_cause: validated.root_cause,
      remediation: validated.remediation,
      mitre: validated.mitre,
      model: modelLabel,
      duration_ms: Math.round(performance.now() - t0),
      created_at: new Date().toISOString(),
    };
  } catch (err) {
    const duration_ms = Math.round(performance.now() - t0);
    if (err instanceof LlmUnavailableError) {
      return nonOk("unavailable", incident, modelLabel, duration_ms);
    }
    if (err instanceof LlmFailedError) {
      console.error(`[investigator] failed class=${err.name}`);
      return nonOk("failed", incident, modelLabel, duration_ms);
    }
    console.error(
      `[investigator] unexpected class=${err instanceof Error ? err.name : "unknown"}`,
    );
    return nonOk("failed", incident, modelLabel, duration_ms);
  }
}
