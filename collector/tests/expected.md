# Expected collector output for fixtures.jsonl

36 input lines -> 34 emitted events, 2 skipped.

| Input | Emitted type | username | source_ip | Note |
|---|---|---|---|---|
| Invalid user user from 192.0.2.50 (x8) | ssh_invalid_user | user | 192.0.2.50 | burst |
| Invalid user admin from 192.0.2.50 (x6) | ssh_invalid_user | admin | 192.0.2.50 | burst |
| Invalid user  from 192.0.2.50 | ssh_invalid_user | "" (empty) | 192.0.2.50 | empty username must NOT crash |
| Connection closed by authenticating user root ... [preauth] | ssh_preauth_disconnect | root | 198.51.100.7 | |
| Connection closed by 198.51.100.7 port 40002 | — | — | — | SKIP (probe, no user) |
| Server listening on 0.0.0.0 port 22. | — | — | — | SKIP (not an auth line) |
| Invalid user <crypto> from 203.0.113.9 (x10) | ssh_invalid_user | sol/eth/... | 203.0.113.9 | low-and-slow |
| Failed password for demo from 203.0.113.77 (x6) | ssh_failed_password | demo | 203.0.113.77 | demo seq |
| Accepted password for demo from 203.0.113.77 | ssh_success | demo | 203.0.113.77 | demo success |
| Accepted publickey for rou from 203.0.113.200 ... SHA256:... | ssh_success | rou | 203.0.113.200 | new IP, known key |

Checks: host_id from config = "ubuntu-01" (not from _HOSTNAME); timestamp = ISO-8601 UTC from
__REALTIME_TIMESTAMP; event_id = sha256(__CURSOR); every event has origin="replay" in replay mode.
