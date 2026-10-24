# sentinel-responder — install (ubuntu-01)

Restricted helper for P1 response. The API never builds a shell string; it
executes this one binary with a fixed subcommand + a validated IP.

Build and test on Linux. nftables + root are required for the live path.
Do not treat a macOS compile as a deploy test.

## Build

```bash
cd ops/responder
cargo build --release
sudo install -m 0755 target/release/sentinel-responder /usr/local/bin/sentinel-responder
```

The crate is a single static-ish binary (one program, no helper scripts).
It calls `nft` with an argument vector (`std::process::Command`), never `sh -c`.

## nft bootstrap

Idempotent. Safe to re-run.

```bash
sudo /usr/local/bin/sentinel-responder init
```

Creates:

- table `inet sentinel`
- set `inet sentinel blocklist` (`type ipv4_addr; flags timeout`)
- set `inet sentinel blocklist6` (`type ipv6_addr; flags timeout`) for IPv6 targets
- chain `inet sentinel input` (filter, hook input, policy accept)
- rules `ip saddr @blocklist drop` and `ip6 saddr @blocklist6 drop`

Block TTL comes from `RESPONSE_BLOCK_TTL_SECONDS` (default **600**). nft
element timeout is the persistence; there is no extra database.

## sudoers

The binary needs root for nft. The API stays a non-root app user.

1. Copy `ops/responder-sudoers.example`, replace `<app_user>` with the API account.
2. Install under `/etc/sudoers.d/` (not done by `cargo build`).
3. `visudo -cf` the file before relying on it.

Exact command the API should spawn (argv, no shell interpolation):

```
sudo
-n
--preserve-env=RESPONSE_ALLOWLIST,RESPONSE_BLOCK_TTL_SECONDS
/usr/local/bin/sentinel-responder
<subcommand>
[IP]
```

## Subcommands

| argv | meaning |
|---|---|
| `block <IP>` | add to set with timeout |
| `unblock <IP>` | remove (rollback); missing element is still `rolled_back` |
| `verify <IP>` | present → exit 0 `verified`; absent → exit 1 `expired` |
| `list` | dump live set as JSON `entries` |
| `init` | create table/set/chain/rule |

`<IP>` is parsed with `std::net::IpAddr::from_str` **before** any nft call.

## Exit codes

| code | meaning |
|---|---|
| 0 | ok (`applied` / `verified` / `rolled_back`; `list`/`init` success) |
| 1 | generic failure, **or** `verify` when the IP is not in the set (`expired`) |
| 2 | bad args / invalid IP |
| 3 | `rejected_by_policy` (allowlist or host address). Approval cannot bypass this. |

Distinguish `verify` absent vs nft failure by `status` in the JSON line (`expired` vs `failed`).

## Policy (inside the binary)

Loaded on every `block`:

- `RESPONSE_ALLOWLIST` — comma-separated CIDRs
- the host’s own addresses from `ip -j addr`, plus `127.0.0.1` and `::1`

If the target matches, stdout is `status: rejected_by_policy` with
`policy_reason` and exit **3**. Unblock/verify/list do not apply this
(rollback of an allowlisted IP must still work).

## Stdout JSON (CONTRACT §8)

One JSON object per invocation, one line, stdout only. Human errors go to stderr.

Runner fields vs `ResponseAction` in `docs/CONTRACT.md` §8:

| Runner | §8 `ResponseAction` |
|---|---|
| `kind`: always `"block_ip"` | `kind` |
| `target` | `target` (IP). `null` for `init`/`list` |
| `status` | `applied` \| `verified` \| `expired` \| `rolled_back` \| `rejected_by_policy` \| `failed` |
| `ttl_seconds` | `ttl_seconds` (configured TTL on `block`; remaining on `verify`/`list` when nft reports it) |
| `expires_at` | `expires_at` (ISO-8601 UTC ms, `...Z`) |
| `applied_at` | `applied_at` (set on successful `block`) |
| `policy_reason` | `policy_reason` |
| `action` | runner-only: `block` \| `unblock` \| `verify` \| `list` \| `init` |
| `entries` | runner-only, `list`: `{target, ttl_seconds?, expires_at?}[]` |

API-only states (`proposed`, `approved`) are **not** emitted here.

Examples:

```json
{"action":"block","kind":"block_ip","target":"192.0.2.10","status":"applied","ttl_seconds":600,"expires_at":"2026-10-24T18:10:00.000Z","applied_at":"2026-10-24T18:00:00.000Z"}
{"action":"block","kind":"block_ip","target":"192.0.2.10","status":"rejected_by_policy","policy_reason":"target in RESPONSE_ALLOWLIST"}
{"action":"verify","kind":"block_ip","target":"192.0.2.10","status":"verified","ttl_seconds":598,"expires_at":"2026-10-24T18:10:00.000Z"}
{"action":"verify","kind":"block_ip","target":"192.0.2.10","status":"expired"}
{"action":"unblock","kind":"block_ip","target":"192.0.2.10","status":"rolled_back"}
{"action":"list","kind":"block_ip","status":"verified","entries":[{"target":"192.0.2.10","ttl_seconds":598,"expires_at":"2026-10-24T18:10:00.000Z"}]}
{"action":"init","kind":"block_ip","status":"applied"}
```

Kevin (`POST /actions/:id/approve`) and Jordi (SEN-13) should bind to
`status` / `target` / `ttl_seconds` / `expires_at` / `applied_at` / `policy_reason`.

## Tests (Linux)

```bash
cd ops/responder
cargo test                          # IP parse + CIDR allowlist (incl. 192.0.2.0/24)
sudo cargo test --features nft-integration
```

The nft test does `init` → `block 192.0.2.99` → `verify` (present) → `unblock` → `verify` (absent).

## Privilege model

See `ops/README.md`. This tree never writes `/etc`.
