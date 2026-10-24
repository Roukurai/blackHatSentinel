import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useHealth, useSettingsOverview } from "../api/queries";
import { setupProgress, setupSteps, type SetupStep, type StepId } from "../lib/setup";
import { AiProviderForm, EnvKeys } from "./Settings";
import { EmptyState, GBadge, Spinner } from "./ui";
import { ApiError } from "../api/client";

function Command({ children }: { children: string }) {
  return <pre className="setup-cmd mono">{children}</pre>;
}

function StepBody({ id, publicBaseUrl }: { id: StepId; publicBaseUrl: string }): ReactNode {
  switch (id) {
    case "access":
      return (
        <>
          <p>Set a user and a long password. Every dashboard and API route then requires them; the browser asks once and remembers.</p>
          <EnvKeys
            keys={[
              { name: "DASHBOARD_USER", example: "<choose a user>" },
              { name: "DASHBOARD_PASS", example: "<choose a long password>" },
            ]}
          />
        </>
      );
    case "ai":
      return (
        <>
          <p>
            Sentinell is self-hosted, so investigations run on your own provider account. Paste a key; it is stored on this host and only its
            last 4 characters are ever shown again.
          </p>
          <AiProviderForm />
        </>
      );
    case "telegram":
      return (
        <>
          <ol className="setup-list">
            <li>
              In Telegram, message <span className="mono">@BotFather</span>, send <span className="mono">/newbot</span> and copy the token.
            </li>
            <li>Send any message to your new bot, then open this URL to find your chat ID:</li>
          </ol>
          <Command>{"https://api.telegram.org/bot<token>/getUpdates"}</Command>
          <EnvKeys
            keys={[
              { name: "TELEGRAM_BOT_TOKEN", example: "<from @BotFather>" },
              { name: "TELEGRAM_CHAT_ID", example: "<your chat id>" },
              { name: "PUBLIC_BASE_URL", example: publicBaseUrl || "http://<server-ip>:8080" },
            ]}
            note="PUBLIC_BASE_URL is used in the alert link, so it must be reachable from your phone."
          />
        </>
      );
    case "collector":
      return (
        <>
          <p>The collector reads SSH authentication events from the journal and sends them to this API. Run it on the server as a user in the <span className="mono">systemd-journal</span> group.</p>
          <Command>{"cd collector && cargo build --release\nAPI_URL=http://127.0.0.1:8080 HOST_ID=ubuntu-01 COLLECTOR_MODE=live \\\n  ./target/release/collector"}</Command>
          <p className="muted">
            For a dry run without live traffic, set <span className="mono">COLLECTOR_MODE=replay</span> and{" "}
            <span className="mono">COLLECTOR_REPLAY_FILE</span>. Replayed events are always labeled.
          </p>
        </>
      );
    case "response":
      return (
        <>
          <p>Optional. Lets you approve a temporary IP block from an incident. Install the fixed-command runner as root:</p>
          <Command>
            {"sudo install -m 0755 ops/sentinel-block /usr/local/sbin/sentinel-block\necho 'sentinel ALL=(root) NOPASSWD: /usr/local/sbin/sentinel-block' \\\n  | sudo tee /etc/sudoers.d/sentinel-block && sudo chmod 0440 /etc/sudoers.d/sentinel-block"}
          </Command>
          <EnvKeys
            keys={[
              { name: "RESPONSE_RUNNER", example: "/usr/local/sbin/sentinel-block" },
              { name: "RESPONSE_RUNNER_SUDO", example: "1" },
              { name: "RESPONSE_ALLOWLIST", example: "<your-ip>/32,<venue-range>/24" },
            ]}
            note="Put your own, your team's and the venue's IPs in the allowlist. They can never be blocked, even with approval."
          />
        </>
      );
    case "incident":
      return (
        <>
          <p>From a different machine, run the low-volume demo against your own server: a few failed logins, then one success.</p>
          <Command>{"TARGET=<server-ip> DEMO_PASS='<demo password>' bash ops/demo-scenario.sh"}</Command>
          <p className="muted">
            An incident appears here within seconds, Telegram sends one alert, and the AI report follows. <Link to="/">Open incidents</Link>
          </p>
        </>
      );
  }
}

function StepMarker({ index, step }: { index: number; step: SetupStep }) {
  if (step.state === "done")
    return (
      <span className="step-marker step-marker--done" aria-label="Done">
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  return (
    <span className={`step-marker${step.state === "attention" ? " step-marker--attention" : ""}`} aria-hidden="true">
      {index + 1}
    </span>
  );
}

export function SetupPage() {
  const overview = useSettingsOverview();
  const health = useHealth();
  const [openId, setOpenId] = useState<StepId | null>(null);

  if (overview.isError) {
    const auth = overview.error instanceof ApiError && overview.error.kind === "auth";
    return (
      <div className="page">
        <EmptyState title={auth ? "Sign-in needed" : "Setup unavailable"}>
          {auth ? "Sign in with the dashboard credentials to continue setup." : "Could not reach the API on this host."}
        </EmptyState>
      </div>
    );
  }
  if (!overview.data)
    return (
      <div className="page">
        <Spinner />
      </div>
    );

  const steps = setupSteps(overview.data, health.data);
  const progress = setupProgress(steps);
  const current = steps.find((s) => s.state !== "done" && !s.optional) ?? steps.find((s) => s.state !== "done");
  const expanded = openId ?? current?.id ?? null;

  return (
    <div className="page page--narrow">
      <header className="page-head">
        <div>
          <h1 className="h-page">Set up Sentinell</h1>
          <p className="sub">
            {progress.complete
              ? "Everything required is running on this host."
              : "Each step checks itself off as soon as this host reports it working."}
          </p>
        </div>
      </header>

      <div className="setup-progress" aria-label={`${progress.done} of ${progress.total} required steps complete`}>
        <div className="setup-progress__bar">
          <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
        <span className="mono">
          {progress.done}/{progress.total}
        </span>
      </div>

      <ol className="setup-steps">
        {steps.map((step, i) => {
          const isOpen = expanded === step.id;
          return (
            <li key={step.id} className={`setup-step setup-step--${step.state}${isOpen ? " setup-step--open" : ""}`}>
              <button
                type="button"
                className="setup-step__head"
                aria-expanded={isOpen}
                onClick={() => setOpenId(isOpen ? ("" as StepId) : step.id)}
              >
                <StepMarker index={i} step={step} />
                <span className="setup-step__text">
                  <span className="setup-step__title">
                    {step.title}
                    {step.optional && <GBadge>Optional</GBadge>}
                    {step.state === "attention" && <GBadge tone="amber">Needs attention</GBadge>}
                  </span>
                  <span className="setup-step__status">{step.status}</span>
                </span>
                <svg className="setup-step__chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {isOpen && (
                <div className="setup-step__body">
                  <StepBody id={step.id} publicBaseUrl={overview.data.public_base_url} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Small progress summary for the sidebar and the incidents page. */
export function useSetupProgress() {
  const overview = useSettingsOverview();
  const health = useHealth();
  if (!overview.data) return null;
  return setupProgress(setupSteps(overview.data, health.data));
}
