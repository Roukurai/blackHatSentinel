#!/usr/bin/env bash
# Run from the ATTACKER machine only (VPN laptop or gateway VPS). NOT on ubuntu-01.
# Low-volume, authorized demo against our own server. Produces a burst then a success.
#
#   TARGET=<vps-ip> DEMO_PASS='<demo-user-password>' bash demo-scenario.sh
#
# Requires: sshpass. The 'demo' user must exist on the target with a Match-User password block.
set -euo pipefail
: "${TARGET:?set TARGET=<vps-ip>}"
: "${DEMO_PASS:?set DEMO_PASS=<demo password>}"
FAILS="${FAILS:-6}"       # enough to cross DETECT_FAST_COUNT (default 5)
echo "[*] $FAILS failed attempts as 'demo' against $TARGET ..."
for i in $(seq 1 "$FAILS"); do
  sshpass -p "wrong-$i" ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password \
    -o PubkeyAuthentication=no -o ConnectTimeout=5 demo@"$TARGET" true 2>/dev/null || true
  echo "    attempt $i (expected: denied)"
  sleep 1
done
echo "[*] one SUCCESS as 'demo' (closes the failed-to-success sequence) ..."
sshpass -p "$DEMO_PASS" ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password \
  -o PubkeyAuthentication=no -o ConnectTimeout=5 demo@"$TARGET" 'echo demo-login-ok; exit' 2>/dev/null || true
echo "[*] done. Check Telegram + dashboard."
