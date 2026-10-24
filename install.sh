#!/usr/bin/env bash
# Public entrypoint for https://sentinell.xyz/install.sh
# Works when piped (curl | bash) or run from a clone.
set -euo pipefail

if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" && -f "$(dirname "${BASH_SOURCE[0]}")/ops/install.sh" ]]; then
  exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ops/install.sh" "$@"
fi

# Piped / remote: fetch ops installer from GitHub raw (same repo).
RAW="${SENTINELL_INSTALL_RAW:-https://raw.githubusercontent.com/Roukurai/blackHatSentinel/main/ops/install.sh}"
SCRIPT="$(curl -fsSL "$RAW")" || { echo "[sentinell] download failed: $RAW" >&2; exit 1; }
exec bash -c "$SCRIPT" sentinell "$@"
