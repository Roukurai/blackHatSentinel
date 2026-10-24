#!/usr/bin/env bash
# Run on ubuntu-01 before a rehearsal. Wipes incident state + block set. Keeps the journal.
# Requires RESET_CONFIRM=1. Optional RESET_SETTINGS=1 also removes the sibling LLM settings file.
set -euo pipefail
REPO=/opt/sentinell
ENV_FILE=$REPO/.env
if [[ ${RESET_CONFIRM:-} != 1 ]]; then
  echo "reset.sh: set RESET_CONFIRM=1 to wipe the incident DB (keeps the journal)" >&2
  exit 2
fi
if [[ -f $ENV_FILE ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
DB="${DB_PATH:-/var/lib/sentinel/sentinel.db}"
SETTINGS="$(dirname "$DB")/llm-settings.json"
echo "[*] stopping collector + api (ignore if not installed)"
sudo systemctl stop sentinel-collector sentinel-api 2>/dev/null || true
echo "[*] removing db: $DB"
rm -f "$DB" "$DB-wal" "$DB-shm"
if [[ ${RESET_SETTINGS:-} == 1 ]]; then
  echo "[*] removing LLM settings: $SETTINGS"
  rm -f "$SETTINGS"
fi
echo "[*] flushing nft block set (if present)"
sudo nft flush set inet sentinel blocklist 2>/dev/null || true
sudo nft flush set inet sentinel blocklist6 2>/dev/null || true
echo "[*] reset done. Restart with:"
echo "    sudo systemctl start sentinel-api.service sentinel-collector.service"
