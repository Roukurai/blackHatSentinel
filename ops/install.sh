#!/usr/bin/env bash
# Minimal Sentinell install for one Ubuntu host (hackathon / self-host).
# Intended to be served as https://sentinell.xyz/install.sh (Jordi/ops deploy).
#
#   curl -fsSL https://sentinell.xyz/install.sh | sh
#   # or from a clone:
#   bash ops/install.sh
#
set -euo pipefail

REPO_URL="${SENTINELL_REPO_URL:-https://github.com/Roukurai/blackHatSentinel.git}"
INSTALL_DIR="${SENTINELL_HOME:-$HOME/sentinell}"
BIN_DIR="${SENTINELL_BIN_DIR:-$HOME/.local/bin}"

echo "[sentinell] install dir: $INSTALL_DIR"

if ! command -v git >/dev/null 2>&1; then
  echo "[sentinell] git is required" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[sentinell] Node.js 22.18+ (24 on VPS) is required" >&2
  exit 1
fi

if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "[sentinell] updating existing clone…"
  git -C "$INSTALL_DIR" pull --ff-only || git -C "$INSTALL_DIR" pull --rebase
else
  echo "[sentinell] cloning…"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "[sentinell] wrote .env from .env.example — edit HOST_ID, Telegram, LLM_*"
fi

echo "[sentinell] npm install (api + web)…"
(cd api && npm install)
(cd web && npm install)

if command -v cargo >/dev/null 2>&1 && [[ -f collector/Cargo.toml ]]; then
  echo "[sentinell] building collector…"
  (cd collector && cargo build --release) || echo "[sentinell] collector build skipped/failed (optional for API-only)"
else
  echo "[sentinell] cargo not found — skip collector build"
fi

mkdir -p "$BIN_DIR"
ln -sfn "$INSTALL_DIR/bin/sentinell" "$BIN_DIR/sentinell"
chmod +x "$INSTALL_DIR/bin/sentinell" "$INSTALL_DIR/ops/install.sh"

cat <<EOF

[sentinell] done.

Next:
  1. Edit $INSTALL_DIR/.env  (HOST_ID, TELEGRAM_*, optional LLM_*)
     Or start the API and set the OpenAI key in the dashboard Settings page (BYO).
  2. Start API:  cd $INSTALL_DIR/api && npm start
  3. Put $BIN_DIR on PATH if needed:  export PATH="$BIN_DIR:\$PATH"
  4. Open the dashboard and create the password.
     MCP local:   sentinell mcp
     MCP remote:  sentinell mcp token create --name <agent>
                  then POST https://<host>/mcp with Authorization: Bearer <token>
                  Prefer TLS. See docs/MCP.md (never print a live token here).
     Claude:      claude mcp add sentinell -- sentinell mcp
  5. Health:     sentinell status

Landing host note: publish this script at https://sentinell.xyz/install.sh

EOF
