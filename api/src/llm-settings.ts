import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadLlmConfig } from "./investigator/config.ts";
import type { LlmConfig } from "./investigator/types.ts";
import {
  catalogEntry,
  isLlmProviderId,
  LLM_PROVIDER_CATALOG,
  LLM_PROVIDER_IDS,
  type LlmProviderId,
  type LlmProviderCatalogEntry,
} from "./llm-providers.ts";

export interface ProviderSlotStored {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface StoredLlmSettings {
  /** @deprecated flat fields — migrated into providers.openai on read */
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  activeProvider?: LlmProviderId;
  providers?: Partial<Record<LlmProviderId, ProviderSlotStored>>;
  updatedAt?: string;
}

export interface ProviderSlotPublic {
  id: LlmProviderId;
  label: string;
  configured: boolean;
  baseUrl: string;
  model: string;
  keyLast4: string | null;
  keyPlaceholder: string;
  modelPlaceholder: string;
  baseUrlPlaceholder: string;
  hint: string;
}

export interface LlmSettingsPublic {
  configured: boolean;
  activeProvider: LlmProviderId;
  baseUrl: string;
  model: string;
  keyLast4: string | null;
  updatedAt: string | null;
  source: "settings" | "env" | "none";
  providers: ProviderSlotPublic[];
  catalog: LlmProviderCatalogEntry[];
}

export interface LlmSettingsPatch {
  activeProvider?: LlmProviderId;
  /** When set with provider fields, writes into that slot (defaults to activeProvider). */
  provider?: LlmProviderId;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/** Derive settings path next to the SQLite DB (or under cwd for :memory:). */
export function llmSettingsPathForDb(dbPath: string): string {
  if (dbPath === ":memory:") {
    return path.resolve("data", "llm-settings.json");
  }
  return path.join(path.dirname(dbPath), "llm-settings.json");
}

function emptyProviders(): Partial<Record<LlmProviderId, ProviderSlotStored>> {
  return {};
}

/** Normalize legacy flat keys into providers.openai. */
export function normalizeStored(raw: StoredLlmSettings): StoredLlmSettings {
  const providers = { ...(raw.providers ?? emptyProviders()) };
  if (raw.apiKey || raw.baseUrl || raw.model) {
    const openai = { ...(providers.openai ?? {}) };
    if (raw.apiKey && !openai.apiKey) openai.apiKey = raw.apiKey;
    if (raw.baseUrl && !openai.baseUrl) openai.baseUrl = raw.baseUrl;
    if (raw.model && !openai.model) openai.model = raw.model;
    providers.openai = openai;
  }
  const activeProvider: LlmProviderId =
    raw.activeProvider && isLlmProviderId(raw.activeProvider)
      ? raw.activeProvider
      : "openai";
  return {
    activeProvider,
    providers,
    updatedAt: raw.updatedAt,
  };
}

export function readStoredLlmSettings(filePath: string): StoredLlmSettings {
  try {
    const text = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return normalizeStored({});
    const o = parsed as Record<string, unknown>;
    const raw: StoredLlmSettings = {};
    if (typeof o.apiKey === "string") raw.apiKey = o.apiKey;
    if (typeof o.baseUrl === "string") raw.baseUrl = o.baseUrl;
    if (typeof o.model === "string") raw.model = o.model;
    if (typeof o.updatedAt === "string") raw.updatedAt = o.updatedAt;
    if (isLlmProviderId(o.activeProvider)) raw.activeProvider = o.activeProvider;
    if (o.providers && typeof o.providers === "object") {
      const providers: Partial<Record<LlmProviderId, ProviderSlotStored>> = {};
      for (const id of LLM_PROVIDER_IDS) {
        const slot = (o.providers as Record<string, unknown>)[id];
        if (!slot || typeof slot !== "object") continue;
        const s = slot as Record<string, unknown>;
        const out: ProviderSlotStored = {};
        if (typeof s.apiKey === "string") out.apiKey = s.apiKey;
        if (typeof s.baseUrl === "string") out.baseUrl = s.baseUrl;
        if (typeof s.model === "string") out.model = s.model;
        providers[id] = out;
      }
      raw.providers = providers;
    }
    return normalizeStored(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return normalizeStored({});
    console.error("[llm-settings] failed to read settings file");
    return normalizeStored({});
  }
}

export function writeStoredLlmSettings(filePath: string, patch: LlmSettingsPatch): StoredLlmSettings {
  const current = readStoredLlmSettings(filePath);
  const providers = { ...(current.providers ?? emptyProviders()) };
  const targetId: LlmProviderId =
    patch.provider && isLlmProviderId(patch.provider)
      ? patch.provider
      : patch.activeProvider && isLlmProviderId(patch.activeProvider)
        ? patch.activeProvider
        : (current.activeProvider ?? "openai");

  const slot: ProviderSlotStored = { ...(providers[targetId] ?? {}) };
  if (patch.apiKey !== undefined) {
    const trimmed = patch.apiKey.trim();
    if (trimmed) slot.apiKey = trimmed;
  }
  if (patch.baseUrl !== undefined) slot.baseUrl = patch.baseUrl.trim();
  if (patch.model !== undefined) slot.model = patch.model.trim();
  providers[targetId] = slot;

  const next: StoredLlmSettings = {
    activeProvider:
      patch.activeProvider && isLlmProviderId(patch.activeProvider)
        ? patch.activeProvider
        : (current.activeProvider ?? "openai"),
    providers,
    updatedAt: new Date().toISOString(),
  };

  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, filePath);
  return next;
}

function activeSlot(stored: StoredLlmSettings): ProviderSlotStored {
  const id = stored.activeProvider ?? "openai";
  return stored.providers?.[id] ?? {};
}

/** Settings file overrides non-empty fields over env; env fills the rest. */
export function resolveLlmConfig(
  settingsPath: string,
  env: NodeJS.ProcessEnv = process.env,
): LlmConfig {
  const stored = readStoredLlmSettings(settingsPath);
  const slot = activeSlot(stored);
  const cat = catalogEntry(stored.activeProvider ?? "openai");
  const fromEnv = loadLlmConfig(env);
  const apiKey = slot.apiKey?.trim() || fromEnv.apiKey;
  const baseUrl = (
    slot.baseUrl?.trim() ||
    cat.baseUrl ||
    fromEnv.baseUrl
  ).replace(/\/$/, "");
  const model = slot.model?.trim() || cat.model || fromEnv.model;
  return {
    baseUrl,
    apiKey,
    model,
    timeoutSeconds: fromEnv.timeoutSeconds,
    configured: Boolean(apiKey && model),
  };
}

function keyLast4(key: string | undefined): string | null {
  if (!key) return null;
  return key.length >= 4 ? key.slice(-4) : key.length > 0 ? "****" : null;
}

export function publicLlmSettings(
  settingsPath: string,
  env: NodeJS.ProcessEnv = process.env,
): LlmSettingsPublic {
  const stored = readStoredLlmSettings(settingsPath);
  const cfg = resolveLlmConfig(settingsPath, env);
  const activeId = stored.activeProvider ?? "openai";
  const slot = activeSlot(stored);
  const hasStored = Boolean(
    slot.apiKey?.trim() || slot.model?.trim() || slot.baseUrl?.trim(),
  );
  const source: LlmSettingsPublic["source"] = !cfg.configured
    ? "none"
    : hasStored
      ? "settings"
      : "env";

  const providers: ProviderSlotPublic[] = LLM_PROVIDER_CATALOG.map((cat) => {
    const s = stored.providers?.[cat.id] ?? {};
    const baseUrl = s.baseUrl?.trim() || cat.baseUrl;
    const model = s.model?.trim() || cat.model;
    const key = s.apiKey?.trim() ?? "";
    return {
      id: cat.id,
      label: cat.label,
      configured: Boolean(key && model),
      baseUrl,
      model,
      keyLast4: keyLast4(key),
      keyPlaceholder: cat.keyPlaceholder,
      modelPlaceholder: cat.model,
      baseUrlPlaceholder: cat.baseUrl || "https://…/v1",
      hint: cat.hint,
    };
  });

  return {
    configured: cfg.configured,
    activeProvider: activeId,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    keyLast4: keyLast4(cfg.apiKey),
    updatedAt: stored.updatedAt ?? null,
    source,
    providers,
    catalog: [...LLM_PROVIDER_CATALOG],
  };
}
