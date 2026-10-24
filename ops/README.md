# ops — owner: Antonio

- systemd units for collector and API
- `reset` script: wipe DB, flush nft blocklist (for clean rehearsals)
- demo scenario script (run from the attacker machine, low volume)
- `sentinel-block` (P1): fixed-command nftables runner (`block|verify|unblock`), strict IP/TTL validation, `inet sentinel blocklist/blocklist6` sets with per-element timeout. Install + sudoers steps are in the script header.
- [`install.sh`](install.sh) — minimal clone + npm install + `sentinell` PATH shim.
  Publish as `https://sentinell.xyz/install.sh` (landing deploy). See [`docs/MCP.md`](../docs/MCP.md).
