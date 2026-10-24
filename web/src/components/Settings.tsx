import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { useHealth, useLlmSettings, useSaveLlmSettings, useSettingsOverview } from "../api/queries";
import type { LlmProviderId, LlmProviderSlot } from "../api/types";
import { fmtDuration, fmtUtc, relAge, useNow } from "../lib/format";
import { EmptyState, GBadge, Note, Spinner, StatusDot } from "./ui";

// ---------- shared ----------

function SettingsHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1 className="h-page">{title}</h1>
        {children && <p className="sub">{children}</p>}
      </div>
    </header>
  );
}

function LoadError({ error, what }: { error: unknown; what: string }) {
  const auth = error instanceof ApiError && error.kind === "auth";
  return (
    <EmptyState title={auth ? "Sign-in needed" : `${what} unavailable`}>
      {auth ? "Dashboard credentials are required to view settings." : `Could not load ${what.toLowerCase()} from the API.`}
    </EmptyState>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The .env keys that control a section. Values are never shown; they live on the host. */
export function EnvKeys({ keys, note }: { keys: { name: string; example: string }[]; note?: string }) {
  const [copied, setCopied] = useState(false);
  const text = keys.map((k) => `${k.name}=${k.example}`).join("\n");
  return (
    <div className="env-keys">
      <div className="env-keys__head">
        <span>
          Set in <span className="mono">.env</span> on the host, then restart the API
        </span>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="mono">{text}</pre>
      {note && <p className="env-keys__note">{note}</p>}
    </div>
  );
}

// ---------- AI provider (BYOK) ----------

export function AiProviderForm({ onSaved }: { onSaved?: () => void }) {
  const q = useLlmSettings();
  const save = useSaveLlmSettings();
  const [selected, setSelected] = useState<LlmProviderId>("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const slot: LlmProviderSlot | undefined = useMemo(() => q.data?.providers.find((p) => p.id === selected), [q.data, selected]);

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

  if (q.isError) return <LoadError error={q.error} what="AI settings" />;
  if (q.isLoading || !q.data || !slot) return <Spinner />;

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
          setMessage(`Saved ${slot.label} as the active provider. No restart needed.`);
          onSaved?.();
        },
        onError: (err) => setMessage(err instanceof Error ? err.message : "Save failed"),
      },
    );
  };

  const onActivateOnly = () => {
    setMessage(null);
    save.mutate(
      { activeProvider: selected },
      {
        onSuccess: () => {
          setMessage(`${slot.label} is now the active provider.`);
          onSaved?.();
        },
        onError: (err) => setMessage(err instanceof Error ? err.message : "Save failed"),
      },
    );
  };

  return (
    <div className="ai-form">
      <div className="provider-tabs" role="tablist" aria-label="AI providers">
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
              spellCheck={false}
              placeholder={slot.keyLast4 ? `••••${slot.keyLast4}` : slot.keyPlaceholder}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <span className="settings-field__hint">
            {slot.keyLast4 ? `Key on file ending …${slot.keyLast4}. Leave blank to keep it.` : "No key stored for this provider yet."} {slot.hint}
          </span>
        </label>

        <div className="settings-grid">
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
          </label>
        </div>
        <span className="settings-field__hint">
          The investigator calls an OpenAI-compatible <span className="mono">/chat/completions</span> endpoint. Use OpenRouter for
          vendors without one.
        </span>

        <div className="settings-actions">
          <button type="submit" className="g-btn g-btn--primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : isActive ? "Save" : "Save and use"}
          </button>
          {!isActive && slot.configured && (
            <button type="button" className="g-btn g-btn--secondary" disabled={save.isPending} onClick={onActivateOnly}>
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

export function AiSettingsPage() {
  const health = useHealth();
  const llm = useLlmSettings();
  const llmOk = health.data?.llm === "ok";
  return (
    <div className="page">
      <SettingsHeader title="AI provider">
        Bring your own key. Sentinell is self-hosted, so the investigator uses your provider account. Keys are stored on this host and
        never appear in alerts, logs or the browser after saving.
      </SettingsHeader>
      {llm.data && (
        <div className="card status-card">
          <StatusDot
            tone={!llm.data.configured ? "gray" : llmOk ? "green" : "amber"}
            label={!llm.data.configured ? "Not connected" : llmOk ? "Connected" : "Key saved, not reachable yet"}
          />
          {llm.data.configured && (
            <span className="muted">
              <span className="mono">{llm.data.model}</span>
              {llm.data.source === "env" && <> · from .env</>}
              {llm.data.updatedAt && <> · updated {fmtUtc(llm.data.updatedAt)}</>}
            </span>
          )}
        </div>
      )}
      <div className="card card--pad">
        <AiProviderForm />
      </div>
      <Note label="Without a key">Detection, incidents and Telegram alerts keep working. Investigations show "AI unavailable".</Note>
    </div>
  );
}

// ---------- read-only sections ----------

function useOverviewPage() {
  const q = useSettingsOverview();
  return q;
}

export function NotificationsSettingsPage() {
  const q = useOverviewPage();
  const health = useHealth();
  if (q.isError) return <div className="page"><LoadError error={q.error} what="Settings" /></div>;
  if (!q.data) return <div className="page"><Spinner /></div>;
  const o = q.data;
  const ok = health.data?.telegram === "ok";
  return (
    <div className="page">
      <SettingsHeader title="Notifications">One Telegram message per new incident, at most one more on escalation. Alerts never include raw logs, usernames or keys.</SettingsHeader>
      <div className="card">
        <dl className="kv-list">
          <Row label="Telegram">
            <StatusDot tone={!o.telegram.configured ? "gray" : ok ? "green" : "red"} label={!o.telegram.configured ? "Not configured" : ok ? "Delivering" : "Last delivery failed"} />
          </Row>
          <Row label="Cooldown">
            <span className="mono">{fmtDuration(o.telegram.cooldown_seconds)}</span> between messages for one incident
          </Row>
          <Row label="Alert link">
            <span className="mono">{o.public_base_url}/incidents/&lt;id&gt;</span>
          </Row>
        </dl>
      </div>
      <EnvKeys
        keys={[
          { name: "TELEGRAM_BOT_TOKEN", example: "<from @BotFather>" },
          { name: "TELEGRAM_CHAT_ID", example: "<your chat id>" },
          { name: "PUBLIC_BASE_URL", example: "http://<server-ip>:8080" },
          { name: "NOTIFY_COOLDOWN_SECONDS", example: "300" },
        ]}
        note="Tokens stay in .env on the host and are never sent to the browser."
      />
    </div>
  );
}

export function ResponseSettingsPage() {
  const q = useOverviewPage();
  if (q.isError) return <div className="page"><LoadError error={q.error} what="Settings" /></div>;
  if (!q.data) return <div className="page"><Spinner /></div>;
  const r = q.data.response;
  return (
    <div className="page">
      <SettingsHeader title="Response">
        Temporary IP blocks, applied only after a person approves them. Protected addresses can never be blocked, even with approval.
      </SettingsHeader>
      <div className="card">
        <dl className="kv-list">
          <Row label="Runner">
            <StatusDot tone={r.runner_configured ? "green" : "gray"} label={r.runner_configured ? `Configured${r.runner_sudo ? " · via sudo" : ""}` : "Not configured"} />
          </Row>
          <Row label="Block duration">
            <span className="mono">{fmtDuration(r.ttl_seconds)}</span>, then the block expires on its own
          </Row>
          <Row label="Protected ranges">
            {r.allowlist.length === 0 ? (
              <span className="warn-text">None. Add your own, your team's and the venue's IPs.</span>
            ) : (
              <span className="badges">
                {r.allowlist.map((cidr) => (
                  <GBadge key={cidr} mono>
                    {cidr}
                  </GBadge>
                ))}
              </span>
            )}
            <div className="muted kv-sub">This host's own addresses and loopback are always protected.</div>
          </Row>
        </dl>
      </div>
      {!r.runner_configured && (
        <Note label="Without a runner">Approving a block records it as failed. Nothing is blocked and nothing is faked.</Note>
      )}
      <EnvKeys
        keys={[
          { name: "RESPONSE_ALLOWLIST", example: "<your-ip>/32,<venue-range>/24" },
          { name: "RESPONSE_BLOCK_TTL_SECONDS", example: "600" },
          { name: "RESPONSE_RUNNER", example: "/usr/local/sbin/sentinel-block" },
          { name: "RESPONSE_RUNNER_SUDO", example: "1" },
        ]}
        note="Install the runner from ops/sentinel-block; the sudoers line is in its header."
      />
    </div>
  );
}

export function HostSettingsPage() {
  const q = useOverviewPage();
  const now = useNow();
  if (q.isError) return <div className="page"><LoadError error={q.error} what="Settings" /></div>;
  if (!q.data) return <div className="page"><Spinner /></div>;
  const o = q.data;
  const d = o.detection;
  return (
    <div className="page">
      <SettingsHeader title="Host & access">The server Sentinell watches, who can open this dashboard, and the detection thresholds.</SettingsHeader>
      <div className="card">
        <dl className="kv-list">
          <Row label="Host">
            <span className="mono">{o.host_id || "—"}</span>
          </Row>
          <Row label="Dashboard access">
            <StatusDot tone={o.dashboard_auth ? "green" : "amber"} label={o.dashboard_auth ? "Sign-in required" : "No password · localhost only"} />
          </Row>
          <Row label="Collector">
            {o.collector.last_event_at ? (
              <>
                Last event <span title={fmtUtc(o.collector.last_event_at)}>{relAge(o.collector.last_event_at, now)}</span> ·{" "}
                <span className="mono">{o.collector.events}</span> events
              </>
            ) : (
              <span className="muted">No events received yet</span>
            )}
          </Row>
          <Row label="Burst">
            <span className="mono">{d.fast_count}</span> failures within <span className="mono">{fmtDuration(d.fast_window_seconds)}</span>
          </Row>
          <Row label="Low and slow">
            <span className="mono">{d.slow_count}</span> failures within <span className="mono">{fmtDuration(d.slow_window_seconds)}</span>
          </Row>
        </dl>
      </div>
      <EnvKeys
        keys={[
          { name: "HOST_ID", example: "ubuntu-01" },
          { name: "DASHBOARD_USER", example: "<choose a user>" },
          { name: "DASHBOARD_PASS", example: "<choose a long password>" },
          { name: "DETECT_FAST_COUNT", example: String(d.fast_count) },
          { name: "DETECT_FAST_WINDOW_SECONDS", example: String(d.fast_window_seconds) },
        ]}
        note="Leave DASHBOARD_USER and DASHBOARD_PASS empty to choose them in the browser on first launch. That password is what MCP must present."
      />
    </div>
  );
}
