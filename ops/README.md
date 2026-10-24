# ops — owner: Antonio

- systemd units for collector and API
- `reset` script: wipe DB, flush nft blocklist (for clean rehearsals)
- demo scenario script (run from the attacker machine, low volume)
- `sentinel-block` (P1): fixed-command nftables runner (`block|verify|unblock`), strict IP/TTL validation, `inet sentinel blocklist/blocklist6` sets with per-element timeout. Install + sudoers steps are in the script header.
- response runner (P1): `ops/responder/` → binary `sentinel-responder`

## Privilege model (response runner)

`sentinel-responder` is a **separate** program with a **fixed** argv surface
(`block` / `unblock` / `verify` / `list` / `init`). It must run as root because
nftables updates need `CAP_NET_ADMIN`. The API stays a non-root app user and
must never concatenate IPs into a shell command.

Install path: `/usr/local/bin/sentinel-responder` (mode `0755`, owned by root).

Sudoers (see `ops/responder-sudoers.example`; not applied by the build):

```
<app_user> ALL=(root) NOPASSWD: /usr/local/bin/sentinel-responder
```

Keep `RESPONSE_ALLOWLIST` and `RESPONSE_BLOCK_TTL_SECONDS` through sudo
(`env_keep` in the example). Policy is enforced **inside the binary** even
after a human approval: allowlisted CIDRs and the host’s own addresses cannot
be blocked (exit `3`, `rejected_by_policy`).

Bootstrap: `sudo sentinel-responder init` (idempotent). Full steps:
`ops/sentinel-responder.install.md`.

`ops/reset.sh` still flushes `inet sentinel blocklist` for rehearsals; it does
not install sudoers or the binary.
