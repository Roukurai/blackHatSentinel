#!/usr/bin/env bash
# ops/replay.sh [burst|real] — replay a captured scenario WITHOUT editing .env
# Run as rou. Never writes the live collector cursor.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a     # load stable config (API_URL, HOST_ID, ...)
unset COLLECTOR_STATE_FILE                  # replay rereads from offset 0; do not touch live cursor
case "${1:-burst}" in
  burst) export COLLECTOR_REPLAY_FILE=/var/lib/sentinel/replay/demo-burst.jsonl ;;
  real)  export COLLECTOR_REPLAY_FILE=/var/lib/sentinel/replay/real.jsonl ;;
  *) echo "usage: $0 [burst|real]" >&2; exit 2 ;;
esac
export COLLECTOR_MODE=replay
if [[ -x /usr/local/bin/sentinel-collector ]]; then
  exec /usr/local/bin/sentinel-collector
fi
exec ./collector/target/release/collector
