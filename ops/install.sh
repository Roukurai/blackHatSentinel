#!/usr/bin/env bash
# Minimal Sentinell install for one Ubuntu host (hackathon / self-host).
# Served at https://sentinell.xyz/install.sh
#
#   curl -fsSL https://sentinell.xyz/install.sh | bash
#   # verify first:
#   curl -fsSL https://sentinell.xyz/install.sh -o install.sh && less install.sh && bash install.sh
#   # or from a clone:
#   bash ops/install.sh
#
# Whole body lives in main() so a truncated download never executes half a script.

set -euo pipefail

main() {
  local REPO_URL="${SENTINELL_REPO_URL:-https://github.com/Roukurai/blackHatSentinel.git}"
  local INSTALL_DIR="${SENTINELL_HOME:-$HOME/sentinell}"
  local BIN_DIR="${SENTINELL_BIN_DIR:-$HOME/.local/bin}"
  local NODE_MIN_MAJOR=22 NODE_MIN_MINOR=18
  local collector_ok=0

  say()  { printf '[sentinell] %s\n' "$*"; }
  die()  { printf '[sentinell] error: %s\n' "$*" >&2; exit 1; }
  need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

  say "install dir: $INSTALL_DIR"

  # --- prerequisites ---------------------------------------------------------
  need git
  need node
  need npm

  local nv major minor
  nv="$(node -p 'process.versions.node')"
  major="${nv%%.*}"; minor="${nv#*.}"; minor="${minor%%.*}"
  if (( major < NODE_MIN_MAJOR || (major == NODE_MIN_MAJOR && minor < NODE_MIN_MINOR) )); then
    die "Node.js ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}+ required (found $nv)"
  fi

  # --- source ----------------------------------------------------------------
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    say "updating existing clone…"
    git -C "$INSTALL_DIR" pull --ff-only \
      || die "local changes in $INSTALL_DIR block a fast-forward; resolve manually"
  else
    say "cloning…"
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  fi

  cd "$INSTALL_DIR"

  if [[ ! -f .env ]]; then
    cp .env.example .env
    chmod 600 .env
    say "wrote .env from .env.example — edit HOST_ID, Telegram, LLM_*"
  fi

  # --- node deps (reproducible when lockfile exists) -------------------------
  local d
  for d in api web; do
    say "installing $d deps…"
    if [[ -f "$d/package-lock.json" ]]; then
      (cd "$d" && npm ci --no-audit --no-fund)
    else
      (cd "$d" && npm install --no-audit --no-fund)
    fi
  done

  say "building dashboard (web/dist)…"
  npm run build --prefix web

  # --- collector -------------------------------------------------------------
  if command -v cargo >/dev/null 2>&1 && [[ -f collector/Cargo.toml ]]; then
    say "building collector…"
    if (cd collector && cargo build --release); then
      collector_ok=1
    else
      say "collector build FAILED"
    fi
  fi

  # --- CLI -------------------------------------------------------------------
  [[ -f "$INSTALL_DIR/bin/sentinell" ]] || die "bin/sentinell missing from repo"
  chmod +x "$INSTALL_DIR/bin/sentinell"
  mkdir -p "$BIN_DIR" "$HOME/.local/state/sentinell"
  ln -sfn "$INSTALL_DIR/bin/sentinell" "$BIN_DIR/sentinell"

  # --- post-install checks ---------------------------------------------------
  local warn=()
  (( collector_ok )) || warn+=("collector not built — no SSH log ingestion until you install Rust (https://rustup.rs) and re-run")
  if ! id -nG | tr ' ' '\n' | grep -qxE 'systemd-journal|adm'; then
    warn+=("user '$USER' can't read sshd logs: sudo usermod -aG systemd-journal $USER  (then re-login)")
  fi
  case ":$PATH:" in *":$BIN_DIR:"*) ;; *) warn+=("add to PATH: export PATH=\"$BIN_DIR:\$PATH\"") ;; esac

  cat <<EOF

[sentinell] done.

Next:
  1. Edit $INSTALL_DIR/.env  (HOST_ID, TELEGRAM_*, optional LLM_*)
     Or start the API and set the model key in the dashboard Settings page (BYO).
  2. Start API:  cd $INSTALL_DIR/api && npm start
     Start collector (needs journal access; separate shell):
       set -a; . $INSTALL_DIR/.env; set +a
       COLLECTOR_STATE_FILE=\$HOME/.local/state/sentinell/cursor $INSTALL_DIR/collector/target/release/collector
     Production (systemd units, sentinel user, nft runner): bash ops/setup-vps.sh --check
  3. Open the dashboard and create the password. It asks for the one-time setup token:
     sudo cat <data dir>/setup-token   (the API log prints the exact path)
     MCP local:   sentinell mcp
     MCP remote:  sentinell mcp token create --name <agent>
                  then POST https://<host>/mcp with Authorization: Bearer <token>
                  Prefer TLS. See docs/MCP.md (never print a live token here).
     Claude:      claude mcp add sentinell -- sentinell mcp
  4. Health:     sentinell status
EOF

  if (( ${#warn[@]} )); then
    printf '\n[sentinell] WARNINGS:\n'
    printf '  ! %s\n' "${warn[@]}"
  fi
}

main "$@"
