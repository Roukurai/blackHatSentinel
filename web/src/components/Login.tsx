import { useState, type FormEvent } from "react";
import { ApiError, login, setupAccount } from "../api/client";
import { Note, Spinner } from "./ui";

export function AuthBoot() {
  return (
    <div className="login">
      <div className="login__card" aria-busy="true" aria-live="polite">
        <Brand />
        <Spinner />
      </div>
    </div>
  );
}

export function SetupPassword({ tokenPath, onSuccess }: { tokenPath?: string; onSuccess: () => Promise<unknown> }) {
  const [setupToken, setSetupToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await setupAccount(username.trim(), password, setupToken.trim());
      setSetupToken("");
      setPassword("");
      setConfirm("");
      setBusy(false);
      await onSuccess();
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? err.message : "Could not save the password.");
    }
  };

  return (
    <div className="login">
      <div className="login__card card card--pad">
        <Brand />
        <div>
          <h1 className="h-section">Create the dashboard password</h1>
          <p className="sub">This is the password for this host. You sign in with it, and an agent must present it before MCP will answer.</p>
        </div>
        <form className="login__form" onSubmit={(e) => void onSubmit(e)}>
          <label className="login__field">
            <span>Setup token</span>
            <span className="g-input">
              <input
                name="setup_token"
                className="mono"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                required
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
              />
            </span>
            <span className="login__hint">
              Proves you control this server. On the server, run <code className="mono">sudo cat {tokenPath ?? "<data dir>/setup-token"}</code> and
              paste the result. It works once and is deleted after setup.
            </span>
          </label>
          <label className="login__field">
            <span>Username</span>
            <span className="g-input">
              <input name="username" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
            </span>
          </label>
          <label className="login__field">
            <span>Password</span>
            <span className="g-input">
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </span>
          </label>
          <label className="login__field">
            <span>Confirm password</span>
            <span className="g-input">
              <input
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </span>
          </label>
          {error && (
            <Note type="error" label="Could not save">
              {error}
            </Note>
          )}
          <button type="submit" className="g-btn g-btn--primary" disabled={busy}>
            {busy ? "Saving…" : "Save and continue"}
          </button>
        </form>
        <p className="login__foot">Stored on this server as a hash. The password itself is not kept in the browser.</p>
      </div>
    </div>
  );
}

export function LoginScreen({ onSuccess }: { onSuccess: () => Promise<unknown> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      setPassword("");
      setBusy(false);
      await onSuccess();
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? err.message : "Sign-in failed.");
    }
  };

  return (
    <div className="login">
      <div className="login__card card card--pad">
        <Brand />
        <div>
          <h1 className="h-section">Sign in</h1>
          <p className="sub">The username and password chosen for this host. An agent uses the same pair before it can read incidents over MCP.</p>
        </div>
        <form className="login__form" onSubmit={(e) => void onSubmit(e)}>
          <label className="login__field">
            <span>Username</span>
            <span className="g-input">
              <input
                name="username"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </span>
          </label>
          <label className="login__field">
            <span>Password</span>
            <span className="g-input">
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </span>
          </label>
          {error && (
            <Note type="error" label="Sign-in failed">
              {error}
            </Note>
          )}
          <button type="submit" className="g-btn g-btn--primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="login__foot">The session cookie is httpOnly and ends when you sign out, or after 12 hours.</p>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="login__brand">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2 3.5 5.5v6c0 5 3.6 9.3 8.5 10.5 4.9-1.2 8.5-5.5 8.5-10.5v-6L12 2Z" fill="currentColor" />
        <path d="M8 12.5h8" stroke="var(--brand-background)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span>Sentinell</span>
    </div>
  );
}
