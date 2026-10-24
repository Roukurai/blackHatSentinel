import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { useLlmSettings, useSaveLlmSettings } from "../api/queries";
import type { LlmProviderId, LlmProviderSlot } from "../api/types";
import { EmptyState, Note, Spinner } from "./ui";

export function SettingsPage() {
  const q = useLlmSettings();
  const save = useSaveLlmSettings();
  const [selected, setSelected] = useState<LlmProviderId>("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const slot: LlmProviderSlot | undefined = useMemo(
    () => q.data?.providers.find((p) => p.id === selected),
    [q.data, selected],
  );

  useEffect(() => {
    if (!q.data) return;
    setSelected(q.data.activeProvider ?? "openai");
  }, [q.data?.activeProvider]);

  useEffect(() => {
    if (!slot) return;
    setModel(slot.model || slot.modelPlaceholder || "");
    setBaseUrl(slot.baseUrl || slot.baseUrlPlaceholder || "");
    setApiKey("");
    setMessage(null);
  }, [slot?.id, slot?.model, slot?.baseUrl, slot?.modelPlaceholder, slot?.baseUrlPlaceholder]);

  if (q.isError) {
    const auth = q.error instanceof ApiError && q.error.kind === "auth";
    return (
      <div className="page">
        <EmptyState title={auth ? "Sign-in needed" : "Settings unavailable"}>
          {auth
            ? "Dashboard credentials are required to manage LLM keys."
            : "Could not load LLM settings from the API."}
        </EmptyState>
      </div>
    );
  }

  if (q.isLoading || !q.data || !slot) {
    return (
      <div className="page">
        <Spinner />
      </div>
    );
  }

  const data = q.data;
  const isActive = data.activeProvider === selected;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    save.mutate(
      {
        provider: selected,
        activeProvider: selected,
        model: model.trim(),
        baseUrl: baseUrl.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      },
      {
        onSuccess: () => {
          setApiKey("");
          setMessage(
            `Saved ${slot.label} and set it as the active investigator provider. No API restart needed.`,
          );
        },
        onError: (err) => {
          setMessage(err instanceof Error ? err.message : "Save failed");
        },
      },
    );
  };

  const onActivateOnly = () => {
    setMessage(null);
    save.mutate(
      { activeProvider: selected },
      {
        onSuccess: () => setMessage(`${slot.label} is now the active investigator provider.`),
        onError: (err) => setMessage(err instanceof Error ? err.message : "Save failed"),
      },
    );
  };

  const keyHint = slot.keyLast4
    ? `Key on file ending …${slot.keyLast4}`
    : "No key stored for this provider yet";

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="h-page">Settings</h1>
          <p className="sub">
            Bring your own API keys (OpenAI, Anthropic, Gemini, OpenRouter, or a custom OpenAI-compatible
            endpoint). Keys stay on the API host — never in Telegram alerts.
          </p>
        </div>
      </header>

      <div className="provider-tabs" role="tablist" aria-label="LLM providers">
        {data.providers.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={selected === p.id}
            className={`provider-tab${selected === p.id ? " provider-tab--active" : ""}`}
            onClick={() => setSelected(p.id)}
          >
            <span>{p.label}</span>
            {p.configured && <span className="provider-tab__dot" title="Key configured" />}
            {data.activeProvider === p.id && <span className="provider-tab__active">Active</span>}
          </button>
        ))}
      </div>

      <form className="settings-form" onSubmit={onSubmit}>
        <label className="settings-field">
          <span className="settings-field__label">{slot.label} API key</span>
          <div className="g-input">
            <input
              className="mono"
              type="password"
              autoComplete="off"
              placeholder={slot.keyLast4 ? `••••${slot.keyLast4}` : slot.keyPlaceholder}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <span className="settings-field__hint">
            {keyHint}. {slot.hint}. Leave blank to keep the current key.
          </span>
        </label>

        <label className="settings-field">
          <span className="settings-field__label">Model</span>
          <div className="g-input">
            <input
              className="mono"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={slot.modelPlaceholder || "model-id"}
              required={selected !== "custom"}
            />
          </div>
        </label>

        <label className="settings-field">
          <span className="settings-field__label">Base URL</span>
          <div className="g-input">
            <input
              className="mono"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={slot.baseUrlPlaceholder || "https://…/v1"}
              required={selected !== "custom"}
            />
          </div>
          <span className="settings-field__hint">
            Investigator uses OpenAI-compatible <span className="mono">/chat/completions</span>. Prefer OpenRouter
            when a vendor has no compatible endpoint.
          </span>
        </label>

        <div className="settings-actions">
          <button type="submit" className="g-btn g-btn--primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : isActive ? "Save" : "Save & use"}
          </button>
          {!isActive && slot.configured && (
            <button
              type="button"
              className="g-btn g-btn--secondary"
              disabled={save.isPending}
              onClick={onActivateOnly}
            >
              Use without changing key
            </button>
          )}
        </div>

        {message && (
          <Note type={save.isError ? "error" : "success"} label={false}>
            {message}
          </Note>
        )}
      </form>
    </div>
  );
}
