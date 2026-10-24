# collector (Rust) — owner: Antonio

Reads `journalctl -u ssh -o json --follow` (live) or a `journalctl -o json` export (replay),
maps lines to `SentinelEvent` (see `docs/CONTRACT.md` §1), POSTs batches to `API_URL/events`.
Persists the last acknowledged cursor; resumes with `--after-cursor`. Runs as user `sentinel`.
