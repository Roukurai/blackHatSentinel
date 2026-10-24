# ops — owner: Antonio

- systemd units for collector and API
- `reset` script: wipe DB, flush nft blocklist (for clean rehearsals)
- demo scenario script (run from the attacker machine, low volume)
- `sentinel-block` is the only response runner: `block|verify|unblock|list`, exit `0` ok / `1` nft or verify miss / `2` bad args / `3` refused (special address, host IP, `/etc/sentinel/allowlist`). Install + sudoers are in the script header.
- Rust responder (`ops/responder`) parked on branch `feat/response-runner`; not used.
