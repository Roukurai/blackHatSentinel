import type { Health, SettingsOverview } from "../api/types";

export type StepId = "access" | "ai" | "telegram" | "collector" | "response" | "incident";
export type StepState = "done" | "attention" | "todo";

export interface SetupStep {
  id: StepId;
  title: string;
  optional: boolean;
  state: StepState;
  /** One line describing the current state on this host. */
  status: string;
}

// Every step is derived from what the host reports; nothing is ticked off in the browser.
export function setupSteps(o: SettingsOverview, health: Health | undefined): SetupStep[] {
  const llmOk = health?.llm === "ok";
  const telegramOk = health?.telegram === "ok";
  return [
    {
      id: "access",
      title: "Protect the dashboard",
      optional: false,
      state: o.dashboard_auth ? "done" : "todo",
      status: o.dashboard_auth
        ? "Sign-in is required. MCP must present the same username and password."
        : "Choose a username and password on the sign-in screen. The dashboard stays locked until you do.",
    },
    {
      id: "ai",
      title: "Connect your AI provider",
      optional: false,
      state: !o.llm.configured ? "todo" : llmOk ? "done" : "attention",
      status: !o.llm.configured
        ? "No API key yet. Investigations report \"AI unavailable\"; detection and alerts still work."
        : llmOk
          ? `${o.llm.active_provider} · ${o.llm.model} is reachable.`
          : `${o.llm.active_provider} key saved, but the provider is not answering yet.`,
    },
    {
      id: "telegram",
      title: "Turn on Telegram alerts",
      optional: false,
      state: !o.telegram.configured ? "todo" : telegramOk ? "done" : "attention",
      status: !o.telegram.configured
        ? "Bot token and chat ID are not set."
        : telegramOk
          ? "Alerts are being delivered."
          : "Configured, but the last delivery failed. Check the bot token and chat ID.",
    },
    {
      id: "collector",
      title: "Start the collector",
      optional: false,
      state: o.collector.last_event_at ? "done" : "todo",
      status: o.collector.last_event_at
        ? `${o.collector.events} SSH events received.`
        : "No SSH events received yet.",
    },
    {
      id: "response",
      title: "Enable temporary IP blocks",
      optional: true,
      state: o.response.runner_configured && o.response.allowlist.length > 0 ? "done" : "todo",
      status: o.response.runner_configured
        ? o.response.allowlist.length > 0
          ? `Runner ready; ${o.response.allowlist.length} protected range(s).`
          : "Runner ready, but the allowlist is empty. Add your own IPs before approving blocks."
        : "Optional. Without a runner, approvals are recorded as failed and nothing is blocked.",
    },
    {
      id: "incident",
      title: "See your first incident",
      optional: false,
      state: o.collector.incidents > 0 ? "done" : "todo",
      status: o.collector.incidents > 0
        ? `${o.collector.incidents} incident(s) detected.`
        : "Run the demo scenario from another machine to trigger one.",
    },
  ];
}

export function setupProgress(steps: SetupStep[]) {
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.state === "done").length;
  return { done, total: required.length, complete: done === required.length };
}
