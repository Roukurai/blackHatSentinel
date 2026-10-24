# web (React + Vite) — owner: Jordi

Operator workspace for Sentinel: incident list, incident investigation (timeline, evidence-linked
AI findings, Telegram delivery status) and pipeline health. Polls the API every 2 s.
Built output is served by `api/`.

Stack: Vite, React 19, strict TypeScript, react-router, TanStack Query. No component library.

Design: Geist (Vercel Design System) layout and component patterns, with the Sentinell brand
identity from the landing page: warm dark palette (`#141210` / cream `#ece7dc`), signal red-orange
accent (used only for attention), phosphor and amber, the shield mark. Mono type is reserved for data. Tokens live in
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

Routes: `/` incidents · `/incidents/:id` incident (Telegram deep link) · `/health` · `/setup` ·
`/settings/ai` (BYOK) · `/settings/notifications` · `/settings/response` · `/settings/host`.

Admin layout: a sidebar (Monitor / Configure) with live status dots. `⌘B` / `Ctrl+B` collapses it to an
icon rail (remembered per browser); on small screens it toggles the drawer.

Setup (`/setup`) is a step list driven only by what the host reports (`GET /settings/overview`,
`/health`, `/settings/llm`): protect the dashboard, connect your AI provider (bring your own key, stored
on the host, only the last 4 characters are ever shown), Telegram, collector, optional response runner,
first incident. Each step ticks itself off; nothing is marked done in the browser.

`⌘K` / `Ctrl+K` opens the command menu: jump to a page or search incidents by IP, ID, severity,
status or pattern. It only navigates; approving a block always goes through the incident's dialog.

## API integration (checked against `api/` on the `kevin` branch)

- JSON at the root: `GET /health`, `GET /incidents`, `GET /incidents/:id` (`Incident & { events }`).
  Requests send `Accept: application/json`; `/incidents/:id` is also the SPA deep link used in
  Telegram. The API serves `web/dist` and returns `index.html` for `Accept: text/html`
  navigations; the Vite dev proxy does the same. `VITE_API_BASE` sets a prefix if the API moves.
- Basic auth: the API answers 401 with `WWW-Authenticate`; the browser prompts and caches the
  credentials. No credentials live in this code.
- `Incident.origin` drives the list Replay badge; `Health.host_id` names the host in the header.
- `POST /incidents/:id/investigate` and `POST /actions/:id/approve|reject` are live. If an API
  without them is used, the UI shows "Not available yet" instead of failing.

## Safety rules the UI enforces

- `username` and `raw_message` render as plain text only; hidden/bidi characters are made visible.
- Findings show their cited `event_id`s; citations missing from the timeline are flagged, not hidden.
- Successful logins are labeled "suspicious, not confirmed", never "compromised".
- Fixture mode is excluded from production builds.
