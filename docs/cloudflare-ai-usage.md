# Cloudflare AI usage

Estimates locally observed Workers AI token usage and, when billing credentials are present,
fetches month-to-date spend.

**It renders only while a `cloudflare-workers-ai` model is active** and clears its status the
moment another provider is selected, so it never competes with the [usage](usage.md) segment.

## Configuration

Written **outside** the installed checkout, e.g. `~/.pi/agent/cloudflare-ai-usage.config.json`
(override with `PI_CF_AI_USAGE_CONFIG`):

```json
{
  "dailyNeuronAllowance": 10000,
  "usdPerThousandNeurons": 0.011,
  "billing": {
    "accountIdEnv": "CLOUDFLARE_ACCOUNT_ID",
    "tokenEnv": "CLOUDFLARE_BILLING_TOKEN",
    "refreshMinutes": 30
  },
  "modelRatesPerMillionTokensUsd": {}
}
```

Per-model rates are required for estimates; without them the status line asks you to configure
them. Only env var **names** are stored in config, never tokens.

## Commands

| Command | Purpose |
| --- | --- |
| `/cf-ai-usage` | Report current usage |

## State

Per-response accounting is appended to `~/.pi/agent/state/cloudflare-ai-usage.jsonl`
(deduplicated by `responseId`). Estimates are computed from your configured rates; they are
not authoritative billing figures.
