# Backend validation — pi-mods-foundation

Work mode: backend (library + CLI tooling; no web surface).
Start commit: `3fd0166` (recorded in `currentCommitHash`).

## Commands and raw output

### 1. Full gate — `npm run check`

```
> npm run typecheck && npm test && node scripts/check-package.mjs
... typecheck: tsc --noEmit (no output) ...
 79 pass
 0 fail
 445 expect() calls
Ran 79 tests across 13 files. [833.00ms]
Package manifest and public assets validated (6 extensions).
check exit: 0
```

Proves: AC7 (typecheck + 0 failures + manifest), and compiles the whole diff.

### 2. Checker negative controls (AC1)

```
=== negative 1: missing entry ===
AssertionError [ERR_ASSERTION]: Missing entry point: ./extensions/nope.ts
exit: 1
=== negative 2: no default export ===
AssertionError [ERR_ASSERTION]: Entry has no default export: ./extensions/_tmp-no-default.ts
exit: 1
=== restored: positive check ===
Package manifest and public assets validated (6 extensions).
exit: 0
```

No `extensions.length` assertion remains. The script passes for any count and
fails loudly on a missing file or a missing default export.

### 3. Ledger server against the real 25 MB `~/.jev-harness/jev.db` (AC5)

```
$ PI_JEV_LEDGER_PORT=37651 bun run extensions/shared/ledger-server.ts
Jev ledger server listening on http://127.0.0.1:37651 (db: /root/.jev-harness/jev.db)

$ curl -s http://127.0.0.1:37651/decision-counts
{"rows":[{"decision":"shell-safety","count":2205},{"decision":"compact-advisor","count":304},
{"decision":"loop-detector","count":304},{"decision":"outbound-leak","count":288},
{"decision":"read-budget","count":180},{"decision":"promise-continue","count":127}, ... ]}

$ curl -s "http://127.0.0.1:37651/recent-calls?limit=1"
{"rows":[{"id":3841,"ts":"2026-10-16T13:13:02.089Z","agent":"claude-code","event":"pre_tool",
"decision":"shell-safety","mode":"enforce","tool":"Bash","model":"clef-flash", ... }]}
```

### 4. No SQLite binding in the Node extension graph (AC5, AC6)

```
$ grep -rn "bun:sqlite\|node:sqlite" extensions --include=*.ts
extensions/shared/index.ts:6: * `bun:sqlite`, which is unavailable in Pi's Node runtime.   <- comment
extensions/shared/ledger-server.ts:15:import { Database } from "bun:sqlite";               <- the only import
```

The only import is in the Bun-run server. `shared/index.ts` mentions it in a
comment but does not import it.

## Acceptance-criteria mapping

| AC | Criterion | Evidence |
|---|---|---|
| 1 | Checker count-free; validates existence + default export | Command 2 (positive + both negatives) |
| 2 | Config precedence; malformed JSON non-fatal | `tests/shared/config.test.ts` (5 tests) |
| 3 | Branch-scoped state ignores junk/abandoned entries | `tests/shared/state.test.ts` (3 tests) |
| 4 | `formatUsage` for percent-only / USD / error, no fabrication | `tests/shared/usage.test.ts` (6 tests) |
| 5 | Ledger server rows + missing-db error; client error paths; no sqlite in extension graph | Commands 3, 4; `tests/shared/ledger-server.test.ts` (4), `tests/shared/ledger.test.ts` (5) |
| 6 | opencode-go maps live payload to 3 windows; failures degrade; key never leaks | `tests/usage/opencode-go.test.ts` (8 tests, incl. cache-scope and key-leak assertions) |
| 7 | `npm run check` exits 0, 0 failures | Command 1 |
| 8 | No `as any` / `as unknown as`; no subprocess/exec; no network in tests | Diff review; injected `fetchImpl` throughout; `grep` for `child_process`/`execFile` (none) |

## Tests new or changed in this diff

- `tests/shared/config.test.ts`, `state.test.ts`, `usage.test.ts`,
  `ledger.test.ts`, `ledger-server.test.ts`
- `tests/usage/opencode-go.test.ts`
- `tests/fixtures/opencode-go-usage.json`

Suite totals: **79 pass / 0 fail** (12 pre-existing + 67 added/changed assertions).

## Notes / caveats

- No extension entry is registered in this increment, so there is **no
  interactive/TUI proof** — by design (see plan "Deferred follow-ups").
- Ledger server lifecycle (auto-start, port selection, shutdown) is deferred to
  the workbench phase; the client degrades to `{rows:[],error}` when it is absent.
- `node_modules` Pi is 1.2.0, matching the pinned `devDependencies`.
