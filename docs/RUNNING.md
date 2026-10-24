# Running Sentinel

Collector has two modes (`live`, `replay`) which give three run scenarios.
The scenario is chosen by the command you run — never by editing `.env`.

| Scenario | Mode   | Source                              | Runs as   | Command                        |
|----------|--------|-------------------------------------|-----------|--------------------------------|
| Live     | live   | journald (real-time SSH auth)       | `sentinel`| `sudo systemctl start sentinel-collector` |
| Replay   | replay | `/var/lib/sentinel/replay/real.jsonl`      | `rou`     | `./ops/replay.sh real`  |
| Burst    | replay | `/var/lib/sentinel/replay/demo-burst.jsonl`| `rou`     | `./ops/replay.sh burst` |

## Live
Reads the systemd journal and streams real attacks as they happen. Needs
journald access, so it runs as the `sentinel` user (member of `systemd-journal`).
This is the real product path; use it for the "real attacks, right now" demo.

## Replay (full history)
Replays every captured SSH event from `real.jsonl` (hundreds of events, many
incidents). Use as the demo-day fallback if live misbehaves, or to show the
full attack landscape. Reads a file only, so it runs as `rou`.

## Burst (one incident)
Replays `demo-burst.jsonl` — a single curated attack (the ~260-attempt brute
force from one IP) that produces ONE clean incident. Use for a tight,
predictable demo beat.

## Preparing / refreshing replay data (VPS only)
Replay files hold real IPs + a key fingerprint — they live in
`/var/lib/sentinel/replay/` and are NEVER committed (`*.jsonl` is gitignored).

    journalctl -u ssh --since yesterday -o json > /var/lib/sentinel/replay/real.jsonl
    # build the burst slice (one attacker IP) from it:
    grep -F "<burst_source_ip>" /var/lib/sentinel/replay/real.jsonl > /var/lib/sentinel/replay/demo-burst.jsonl

## VPS setup
On ubuntu-01 as `rou` (from a laptop copy of this repo, or after the first clone):

    bash ops/setup-vps.sh --check
    bash ops/setup-vps.sh --apply --allow <team-ip> ...
    # edit /opt/sentinell/.env secrets (DASHBOARD_*, TELEGRAM_*; never commit)
    bash ops/setup-vps.sh --apply --start
    bash ops/setup-vps.sh --demo-user
    bash ops/setup-vps.sh --verify

Collector binary: `/usr/local/bin/sentinel-collector`.
Units: `sentinel-api.service`, `sentinel-collector.service`.
Logs:

    journalctl -u sentinel-api -f
    journalctl -u sentinel-collector -f

`--check` is read-only. `--apply` is idempotent (skips phases already at target). Do not enable ufw; do not modify nft table `inet filter`.

## Reset between rehearsals
    RESET_CONFIRM=1 ./ops/reset.sh    # wipes incident DB + nft blocklist, keeps the journal
    # RESET_SETTINGS=1 also removes llm-settings.json next to the DB
