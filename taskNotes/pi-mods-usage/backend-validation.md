# Backend validation — pi-mods-usage

Work mode: backend (extension lifecycle; TUI surface).
Start commit: `c6bc0da` (recorded in `currentCommitHash`).

## 1. Full gate — `npm run check`

```
> npm run typecheck && npm test && node scripts/check-package.mjs
... tsc --noEmit (clean) ...
 86 pass
 0 fail
 461 expect() calls
Ran 86 tests across 15 files. [798.00ms]
Package manifest and public assets validated (7 extensions).
check exit: 0
```

Proves: AC7 (typecheck + 0 failures + manifest) and that the new entry validates
(`check-package.mjs` now checks default exports; `usage/index.ts` passes).

## 2. Real Pi load — print mode

```
$ pi -ne -e ./extensions/usage/index.ts -p --no-session 'say ok'
Warning: No models match pattern "opencode-go/deepseek-v4-flash"        # pre-existing, unrelated
Warning: No models match pattern "opencode-go/deepseek-v4-flash-vision-exp"
Warning: No models match pattern "opencode-go/minimax-m2.7"
ok
pi exit: 0
```

Proves AC1: the extension **loads in real Pi without error** (a load failure shows
`Failed to load extension …`; none appeared) and runs end to end.

## 3. Lifecycle smoke test (Bun, mock `pi`/`ctx`)

```
$ bun /tmp/usage-smoke.mjs
registered command: usage
1) opencode-go status: ["usage","opencode-go: rolling 2% · weekly 0% · monthly 0% (percent-only; provider reports no spend or tokens)"]
1) notifications: []
2) after switch status (expect [['usage', undefined]]): [["usage",null]]
3) missing-auth status: ["usage","usage: opencode-go has no configured auth (set OPENCODE_API_KEY or sign in to Pi)"]
3) missing-auth notify: ["usage: opencode-go has no configured auth (set OPENCODE_API_KEY or sign in to Pi)","error"]
4) print-mode ui calls (expect 0): 0
OK
smoke exit: 0
```

(`null` in step 2 is `JSON.stringify` of `undefined` — the segment is cleared.)

Proves AC2 (windows render; segment clears on provider switch), AC3 (missing auth
is visible; the key comes from Pi auth — the mock injects it, no env var is set),
AC4 (errors surface via status + error notify), AC6 (no UI calls in print mode).

## 4. Key is resolved from Pi, not a new env requirement

`extensions/usage/index.ts` calls
`ctx.modelRegistry.getApiKeyForProvider("opencode-go")` (verified present on
`ExtensionContext` in installed 1.2.0) and falls back to the configured env var.
The smoke test sets **no** `OPENCODE_API_KEY` and still succeeds via injected auth.

## Acceptance-criteria mapping

| AC | Criterion | Evidence |
|---|---|---|
| 1 | Loads in Pi; `/usage` exists | §2, §3 (`registered command: usage`) |
| 2 | opencode-go windows render; cleared for others | §3 steps 1–2 |
| 3 | Key from Pi; real absence fails visibly | §3 step 3, §4 |
| 4 | Provider failure fails visibly | §3 step 3 (notify error); reporter error path tested in `tests/usage/opencode-go.test.ts` |
| 5 | Nothing dropped | `cloudflare-ai-usage.ts` present and in `pi.extensions` (7 entries) |
| 6 | No UI calls in print mode, no throw | §3 step 4, §2 |
| 7 | `npm run check` exit 0 | §1 |
| 8 | No sqlite; key not stored/logged; no casts | diff review; `grep` below |

## Tests new or changed in this diff

- `tests/usage/config.test.ts` (new, 4 tests)
- `tests/usage/entry.test.ts` (new, 2 tests)
- `tests/usage/opencode-go.test.ts` (changed: injected-`apiKey` case)

Suite totals: **86 pass / 0 fail**.

## Hygiene checks

```
$ grep -rn "bun:sqlite\|node:sqlite" extensions/usage   # none
$ grep -rn "as any\|as unknown as\|child_process\|pi.exec" extensions/usage   # none
```

## Caveats

- The TUI **status repaint, `/usage` notification rendering, theme, and
  fullscreen** still need one human run; the smoke test proves logic, not pixels.
- No `message_end` token accounting and no Cloudflare port in this increment
  (deferred, tracked in the plan's roadmap).
