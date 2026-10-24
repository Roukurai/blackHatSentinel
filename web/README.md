# web (React + Vite) — owner: Jordi

Operator workspace for Sentinel: incident list, incident investigation (timeline, evidence-linked
AI findings, Telegram delivery status) and pipeline health. Polls the API every 2 s.
Built output is served by `api/`.

Stack: Vite, React 19, strict TypeScript, react-router, TanStack Query. No component library.

Design: Geist (Vercel Design System) layout and component patterns, with the Sentinell brand
identity from the landing page: warm dark palette (`#141210` / cream `#ece7dc`), signal red-orange
accent, phosphor and amber, the shield mark, grid/glow background. Tokens live in
`src/styles/tokens.css` (`--brand-*` primitives mapped onto the `--ds-*` names the layout uses).

Fonts: JetBrains Mono (OFL) is bundled. Sentient is loaded from the Fontshare API because its
license (ITF FFL) does not allow redistributing the font files from a public repository; offline
it falls back to a local serif, and nothing depends on it.

## Run

```bash
cd web
npm install
npm run dev:fixtures   # local fixture data, bannered "FIXTURE DATA", dev only
npm run dev            # proxies the API to VITE_API_TARGET (see .env.example)
npm run build          # type-check + production build into web/dist
```

Routes: `/` incidents · `/incidents/:id` incident (Telegram deep link) · `/health`.

## API assumptions (pending agreement, see docs/CONTRACT.md)

- JSON API under `VITE_API_BASE` (default `/api`) so `/incidents/:id` can be the SPA deep link.
  The API should serve `index.html` for other GETs. Set `VITE_API_BASE=""` if routes stay at root.
- `GET /incidents/:id` returns `Incident & { events: SentinelEvent[] }`.
- Optional extras the UI uses when present: `Incident.origin`, `Health.host_id`.
- Basic auth is handled by the browser's native prompt; no credentials live in this code.

## Safety rules the UI enforces

- `username` and `raw_message` render as plain text only; hidden/bidi characters are made visible.
- Findings show their cited `event_id`s; citations missing from the timeline are flagged, not hidden.
- Successful logins are labeled "suspicious, not confirmed", never "compromised".
- Fixture mode is excluded from production builds.
