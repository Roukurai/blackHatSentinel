import type { DatabaseSync } from "node:sqlite";
import { latestEventTimestamp } from "./db.ts";
import { publicLlmSettings } from "./llm-settings.ts";
import type { Config } from "./types.ts";

// Read-only snapshot of this host's configuration for the admin UI and setup steps.
// Never includes secrets: only whether something is set.
export interface SettingsOverview {
  host_id: string;
  public_base_url: string;
  dashboard_auth: boolean;
  telegram: { configured: boolean; cooldown_seconds: number };
  llm: { configured: boolean; active_provider: string; model: string; source: "settings" | "env" | "none" };
  collector: { last_event_at: string | null; events: number; incidents: number };
  response: { allowlist: string[]; ttl_seconds: number; runner_configured: boolean; runner_sudo: boolean };
  detection: { fast_count: number; fast_window_seconds: number; slow_count: number; slow_window_seconds: number };
}

function count(db: DatabaseSync, table: "events" | "incidents"): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number | bigint };
  return Number(row.n);
}

export function settingsOverview(db: DatabaseSync, config: Config): SettingsOverview {
  const llm = publicLlmSettings(config.llmSettingsPath);
  return {
    host_id: config.hostId ?? "",
    public_base_url: config.publicBaseUrl,
    dashboard_auth: Boolean(config.dashboardUser && config.dashboardPass),
    telegram: { configured: Boolean(config.telegramToken && config.telegramChatId), cooldown_seconds: config.notifyCooldownSeconds },
    llm: { configured: llm.configured, active_provider: llm.activeProvider, model: llm.model, source: llm.source },
    collector: { last_event_at: latestEventTimestamp(db), events: count(db, "events"), incidents: count(db, "incidents") },
    response: {
      allowlist: config.response?.allowlist ?? [],
      ttl_seconds: config.response?.ttlSeconds ?? 0,
      runner_configured: Boolean(config.response?.runner),
      runner_sudo: Boolean(config.response?.runnerSudo),
    },
    detection: {
      fast_count: config.detect.fastCount,
      fast_window_seconds: config.detect.fastWindowMs / 1000,
      slow_count: config.detect.slowCount,
      slow_window_seconds: config.detect.slowWindowMs / 1000,
    },
  };
}
