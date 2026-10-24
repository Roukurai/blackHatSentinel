#!/usr/bin/env bash
# Run on ubuntu-01 as root/sudo. Creates a 'demo' user that CAN use a password (demo only).
# This is the single password-auth exception; everyone else stays key-only.
set -euo pipefail
DEMO_PASS="${1:?usage: enable-demo-user.sh <password>}"
id demo >/dev/null 2>&1 || adduser --disabled-password --gecos "" demo
echo "demo:${DEMO_PASS}" | chpasswd
# allow password auth for ONLY this user
cat > /etc/ssh/sshd_config.d/20-demo.conf <<CONF
Match User demo
    PasswordAuthentication yes
    PubkeyAuthentication no
CONF
sshd -t && systemctl reload ssh
echo "[*] demo user ready; password auth enabled for 'demo' only."
echo "[*] remove after event: rm /etc/ssh/sshd_config.d/20-demo.conf && systemctl reload ssh && deluser --remove-home demo"
