# shared (library)

`extensions/shared/` is a library imported by the extensions, **never registered** as an
extension entry. It holds the pieces more than one feature needs.

| File | Contents |
| --- | --- |
| `config.ts` | `loadConfig` (project `.pi` → cwd → agent dir → extension dir), validators, numeric clamping. |
| `state.ts` | Branch-aware state helpers, excluded from model context. |
| `usage.ts` | `UsageWindow` / `ProviderUsage` types and `formatUsage`. |
| `ledger.ts` | Node-safe HTTP client for the Jev decision ledger; never throws, returns `{ rows, error }`. |
| `ledger-server.ts` | Bun-run read-only SQLite server that `ledger.ts` talks to. Pi runs extensions under Node, where `bun:sqlite` is unavailable, so the ledger is read out of process. |
| `panel.ts` | The bordered panel renderer and `meter` shared by the cockpit and duck. |
| `questionnaire.ts` | The reusable Claude-style AskUserQuestion modal used by `/duck answer`. |
| `index.ts` | Barrel export. |

## Why a library

Locked decision from the mods plan: registered extensions plus one shared library, so the
manifest lists entry points only. Features import from `../shared/*.ts` directly.
