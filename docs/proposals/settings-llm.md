# PROPOSAL: `GET/PUT /settings/llm` (multi-provider BYO keys)

Status: **proposed — pending team agreement** before merging into [`docs/CONTRACT.md`](../CONTRACT.md).  
Linear: [JOR-297](https://linear.app/jordidimass/issue/JOR-297/byo-openai-key-in-dashboard).

Implementation may ship ahead of contract confirmation for the hackathon demo; treat this text as the candidate §6 addition.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/settings/llm` | Public LLM settings (no full keys) + provider catalog placeholders |
| PUT | `/settings/llm` | Upsert one provider slot and/or switch `activeProvider` |

Auth: same dashboard basic auth as other non-ingest routes.

### Providers (placeholders)

| id | Label | Default base URL | Example model | Key placeholder |
|---|---|---|---|---|
| `openai` | OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | `sk-…` |
| `anthropic` | Anthropic | `https://api.anthropic.com/v1` | `claude-sonnet-4-5` | `sk-ant-…` |
| `gemini` | Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` | `AIza…` |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` | `sk-or-…` |
| `custom` | Custom (OpenAI-compatible) | _(empty)_ | _(empty)_ | `API key` |

Only **one** `activeProvider` is used by the investigator. The investigator speaks **OpenAI-compatible** `/chat/completions`; prefer OpenRouter when a vendor has no compatible endpoint.

### GET response

```ts
interface LlmSettingsPublic {
  configured: boolean;
  activeProvider: LlmProviderId;
  baseUrl: string;             // resolved active
  model: string;
  keyLast4: string | null;     // active key only; never full key
  updatedAt: string | null;
  source: "settings" | "env" | "none";
  providers: ProviderSlotPublic[];  // placeholders + configured flags per vendor
}
```

### PUT body

```ts
interface LlmSettingsUpdate {
  activeProvider?: LlmProviderId;
  provider?: LlmProviderId;  // slot to write (defaults to activeProvider)
  apiKey?: string;           // omit or "" to leave existing key in that slot
  baseUrl?: string;
  model?: string;
}
```

Response: same as GET.

## Persistence

- File next to `DB_PATH`, e.g. `data/llm-settings.json` (gitignored under `data/`).
- Shape: `{ activeProvider, providers: { openai?: { apiKey, baseUrl, model }, … } }`.
- Legacy flat `{ apiKey, model, baseUrl }` is migrated into `providers.openai` on read.
- Active slot overrides `.env` for the investigator; env remains the fallback.
- Investigator **re-resolves** config on each investigate / health probe (no restart required).

## Non-negotiables

- Never put API keys (or raw logs) in Telegram alerts.
- Never return full keys from any API response or log line.
- Detection and Telegram keep working when LLM is unconfigured (`investigation.status = "unavailable"`).
