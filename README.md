# Sentinell.xyz

**The autonomous L1 security analyst for a single Linux server.**

Sentinel watches SSH authentication activity on an Ubuntu host, classifies attacker behavior,
links related events into one incident, sends a Telegram alert, and runs a bounded AI
investigation that cites every piece of evidence and states what it does not know.
Responses (temporary IP block) are policy-checked, reversible, and human-approved.

Built at the **Grok Bot Guatemala Hackathon** (Alaris Security / SpaceXAI, Universidad del Istmo)
on **24 Oct 2026**. All code in this repository was written during the event.

## Flow

```
SSH journal ─▶ Rust collector ─▶ TS API + SQLite ─▶ detection / incident ─▶ Telegram alert
                                                         └─▶ AI investigator ─▶ React dashboard ─▶ approved response
```

## Layout

| Folder       | Owner   | Scope |
|--------------|---------|-------|
| `collector/` | Antonio | Rust journald collector, live + labeled replay |
| `api/`       | Kevin   | Event ingestion, SQLite, correlation, incidents, Telegram notifier |
| `api/` (investigator module) | Hugo | Bounded read-only AI investigator, typed findings |
| `web/`       | Jordi   | Incident workspace dashboard |
| `ops/`       | Antonio | systemd units, reset script, demo scenario, response runner (P1) |
| `docs/`      | All     | `CONTRACT.md` is the source of truth for interfaces |

## Status

Under construction. Run instructions will be added as components land.

## Data notice

- Replayed data is always labeled `origin: "replay"`.
- Raw journal exports and real secrets are never committed (see `.gitignore`).
- Scope: one Ubuntu host, SSH authentication. Not a production endpoint security product.
