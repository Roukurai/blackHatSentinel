import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  publicLlmSettings,
  resolveLlmConfig,
  writeStoredLlmSettings,
} from "./llm-settings.ts";

test("settings file overrides env without echoing full key", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sentinel-llm-"));
  const file = path.join(dir, "llm-settings.json");
  try {
    writeStoredLlmSettings(file, {
      activeProvider: "openai",
      provider: "openai",
      apiKey: "sk-test-abcdefghijklmnop",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    });
    const cfg = resolveLlmConfig(file, {
      LLM_API_KEY: "sk-env-should-lose",
      LLM_MODEL: "env-model",
      LLM_BASE_URL: "https://example.invalid/v1",
    });
    assert.equal(cfg.apiKey, "sk-test-abcdefghijklmnop");
    assert.equal(cfg.model, "gpt-4o-mini");
    assert.equal(cfg.configured, true);

    const pub = publicLlmSettings(file, {});
    assert.equal(pub.configured, true);
    assert.equal(pub.activeProvider, "openai");
    assert.equal(pub.keyLast4, "mnop");
    assert.equal(pub.providers.length, 5);
    assert.ok(pub.providers.some((p) => p.id === "anthropic" && p.keyPlaceholder.startsWith("sk-ant")));
    assert.ok(!JSON.stringify(pub).includes("sk-test-abcdefghijklmnop"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("empty apiKey on PUT leaves existing key", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sentinel-llm-"));
  const file = path.join(dir, "llm-settings.json");
  try {
    writeStoredLlmSettings(file, {
      provider: "openai",
      apiKey: "sk-keep-me-xxxx",
      model: "gpt-4o-mini",
    });
    writeStoredLlmSettings(file, { provider: "openai", apiKey: "   ", model: "gpt-4o" });
    const cfg = resolveLlmConfig(file, {});
    assert.equal(cfg.apiKey, "sk-keep-me-xxxx");
    assert.equal(cfg.model, "gpt-4o");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("multi-provider slots keep keys separate; active switches resolve", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sentinel-llm-"));
  const file = path.join(dir, "llm-settings.json");
  try {
    writeStoredLlmSettings(file, {
      provider: "openai",
      activeProvider: "openai",
      apiKey: "sk-openai-1111",
      model: "gpt-4o-mini",
    });
    writeStoredLlmSettings(file, {
      provider: "openrouter",
      apiKey: "sk-or-2222",
      model: "anthropic/claude-sonnet-4-5",
      baseUrl: "https://openrouter.ai/api/v1",
    });
    writeStoredLlmSettings(file, { activeProvider: "openrouter" });

    const cfg = resolveLlmConfig(file, {});
    assert.equal(cfg.apiKey, "sk-or-2222");
    assert.equal(cfg.model, "anthropic/claude-sonnet-4-5");

    const pub = publicLlmSettings(file, {});
    assert.equal(pub.activeProvider, "openrouter");
    const openai = pub.providers.find((p) => p.id === "openai");
    const or = pub.providers.find((p) => p.id === "openrouter");
    assert.equal(openai?.keyLast4, "1111");
    assert.equal(or?.keyLast4, "2222");
    assert.equal(or?.configured, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
