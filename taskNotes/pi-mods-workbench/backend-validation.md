# Backend validation — pi-mods-workbench

Work mode: backend (extension logic) + frontend (TUI; see `frontend-validation.md`).
Start commit: `c57e8ce`.

## 1. Full gate

```
$ npm run check
... tsc --noEmit (clean) ...
 115 pass
 0 fail
 536 expect() calls
Ran 115 tests across 23 files. [896.00ms]
Package manifest and public assets validated (9 extensions).
check exit: 0
```

## 2. Real Pi loads (print mode)

```
$ pi -ne -e ./extensions/workbench/index.ts -p --no-session 'say ok'   → ok, exit 0
$ pi -ne -e ./extensions/duck/index.ts      -p --no-session 'say ok'   → ok, exit 0
```

No `Failed to load extension` output; both entries register.

## 3. Ledger server session endpoints

```
$ PI_JEV_LEDGER_PORT=37652 bun run extensions/shared/ledger-server.ts
Jev ledger server listening on http://127.0.0.1:37652 (db: /root/.jev-harness/jev.db)
$ curl -s .../session-summary   → {"rows":[{"entries":0,"calls":0,"tokens":0,"tools":{}}]}
$ curl -s .../session-calls?limit=1 → {"rows":[]}
```

## Acceptance-criteria mapping

| AC | Criterion | Evidence |
|---|---|---|
| 1 | Both entries load; commands exist | §2, `/pet` `/context` `/report` `/cockpit` `/duck` registered |
| 2 | All features `false` → entry does nothing | flags checked per event; config test |
| 3 | One feature throwing does not break others | per-feature `try` in `index.ts` |
| 4 | `pickVerb`/`moodFrom`/`stats` pure + tested | `tests/workbench/{pet,stats}.test.ts` |
| 5 | footer restored on shutdown; cockpit hidden < 120 | `statusline.ts` `setFooter(undefined)`; cockpit `visible:(w)=>w>=120` |
| 6 | `/context` reports injector ceilings; no fabrication | `tests/workbench/context.test.ts` |
| 7 | `/report` reads ledger; missing server visible | §3; `tests/workbench/report.test.ts`; cockpit ledger error line |
| 8 | `/duck` questions-only; nested usage in header; failure visible | `tests/duck/prompt.test.ts`; `duck/index.ts` header |
| 9 | print mode: no UI calls, no throw | `ctx.mode` guards; §2 |
| 10 | `npm run check` exit 0 | §1 |
| 11 | Nothing removed | 9 entries include `usage`, `cloudflare-ai-usage` |
| 12 | No sqlite in extension graph; no casts | grep below |

## Tests new/changed in this diff

`tests/workbench/{config,pet,stats,cockpit,context,report,mcp}.test.ts`,
`tests/duck/prompt.test.ts`.

## Hygiene

```
$ grep -rn "bun:sqlite\|node:sqlite" extensions/workbench extensions/duck   # none
$ grep -rn "child_process\|pi\.exec\|as unknown as\|as any" extensions/workbench extensions/duck   # none
```

## Caveats / deviations

- **Ledger-server auto-start was not implemented.** Plan-2 I4 lists it, but the
  definition of done forbids `child_process`/`pi.exec`, so auto-start is
  **deferred**; the server is started manually (walkthrough §3) and the cockpit
  shows a visible line when it is absent.
- **MCP renderer is text-based**, not a full table/diff: it renders `mcp__*` text
  results legibly with collapse/expand and falls through otherwise.
- **`/duck` renders in a widget** (`aboveEditor`), not the right overlay; the spec
  allowed "overlay **or** widget". Overlay is a follow-up if desired.
- Interactive rendering is manual-check-only (see `frontend-validation.md`).
