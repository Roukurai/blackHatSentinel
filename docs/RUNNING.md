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
    # regenerate the burst slice from it:
    python3 ops/slice-burst.py   # filters real.jsonl → demo-burst.jsonl

## Reset between rehearsals
    ./ops/reset.sh    # wipes incident DB + nft blocklist, keeps the journal