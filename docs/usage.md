# Usage (opencode-go)

Provider quota display for opencode-go. One footer status segment shows the provider's
rolling, weekly, and monthly windows; it refreshes on a timer and on model change, and
it is cleared when another provider becomes active.

## What it reports

- Percent and reset time for each window, from
  `GET https://opencode.ai/zen/go/v1/usage`.
- Locally observed token totals for the session.

The provider API returns percentages only — no token counts, no cost, and no price list
is published for these models — so no dollar figure is invented. Locally counted tokens
are shown; money is not.

Cloudflare Workers AI usage stays in its own [cloudflare-ai-usage](cloudflare-ai-usage.md)
extension. There is deliberately **no cross-provider merge**: each extension renders only
while its own provider is the active model.

## Commands

| Command | Purpose |
| --- | --- |
| `/usage` | Refresh and report immediately |

## Configuration

`usage.config.json`, resolved project `.pi` → cwd → agent dir → extension dir:

```json
{
  "refreshMinutes": 5,
  "opencodeGo": {
    "keyEnv": "OPENCODE_API_KEY",
    "baseUrl": "https://opencode.ai/zen/go/v1/usage"
  }
}
```

`refreshMinutes` is clamped to 1–240. A config file only ever **names** an environment
variable; it never contains a key. The key is resolved from Pi's own provider auth first
(`ctx.modelRegistry.getApiKeyForProvider("opencode-go")`), then from `keyEnv`.

## Failure behaviour

A missing key shows `opencode-go has no configured auth (set <keyEnv> or sign in to Pi)`.
A 4xx/5xx/timeout renders an error suffix in the same segment. Nothing throws, and the
extension does nothing at all in `print` mode.

## Files

- `extensions/usage/index.ts` — status segment, timer, `/usage`.
- `extensions/usage/opencode-go.ts` — the fetch and payload mapping.
- `extensions/usage/config.ts` — config load and validation.
