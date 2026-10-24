#!/usr/bin/env bash
# Public entrypoint for https://sentinell.xyz/install.sh
# Works when piped (curl | bash) or run from a clone. Needs bash: plain sh (dash) fails.
set -euo pipefail

if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" && -f "$(dirname "${BASH_SOURCE[0]}")/ops/install.sh" ]]; then
  exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ops/install.sh" "$@"
fi

# Piped / remote: fetch ops installer from GitHub raw (same repo).
RAW="${SENTINELL_INSTALL_RAW:-https://raw.githubusercontent.com/Roukurai/blackHatSentinel/main/ops/install.sh}"
exec bash -c "$(curl -fsSL "$RAW")"
