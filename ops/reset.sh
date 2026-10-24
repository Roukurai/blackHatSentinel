#!/usr/bin/env bash
# Run on ubuntu-01 before a rehearsal. Wipes incident state + block set. Keeps the journal.
set -euo pipefail
DB="${DB_PATH:-$HOME/blackHatSentinel/api/data/sentinel.db}"
echo "[*] stopping api + collector (ignore if not yet installed)"
sudo systemctl stop sentinel-collector 2>/dev/null || true
pkill -f 'node .*api' 2>/dev/null || true
echo "[*] removing db: $DB"
rm -f "$DB" "$DB-wal" "$DB-shm"
echo "[*] flushing nft block set (if present)"
sudo nft flush set inet sentinel blocklist 2>/dev/null || true
echo "[*] reset done. Restart api + collector."
