# Specs — pi-mods-workbench (Increment 4 + duck)

Parent: `taskNotes/pi-mods-workbench/taskFindings.md`
Sources: `docs/pi-mods-plan.md` §7, `docs/pi-mods-plan-2.md` §4, `docs/temp/workbench.md`.

| # | Spec | Deliverable | Entry | Plan |
|---|------|-------------|-------|------|
| A | pet + statusline | `workbench/{index,config,pet,verbs,statusline,stats}.ts` | workbench | `spec-a-pet-statusline/taskFindings.md` |
| B | cockpit | `workbench/cockpit.ts` + overlay + ledger read | workbench | `spec-b-cockpit/taskFindings.md` |
| C | observability | `workbench/{mcp-renderer,context,report}.ts` + `ledger-server` read endpoints | workbench | `spec-c-observability/taskFindings.md` |
| D | duck | `extensions/duck/index.ts` + `buildDuckPrompt` | duck | `spec-d-duck/taskFindings.md` |

## Sequencing

```
A (entry + pet + statusline) → B (cockpit) → C (observability) → D (duck)
```

Each spec commits independently and leaves `npm run check` green. A is the
prerequisite for B and C (shared entry + config).

## Cross-cutting rules

- `ctx.mode === "tui" || ctx.mode === "rpc"` guard on every `ctx.ui.*` call.
- Feature flags in `workbench.config.json`; each feature in its own `try`.
- Ledger only via `shared/ledger.ts` (HTTP). The extension does **not** spawn the
  server (no `child_process` — see parent plan blocker 1).
- No network in tests; no `as any` / `as unknown as`.
- Restore every UI override (`setFooter(undefined)`, default indicator/message) on
  `session_shutdown`.

## Out of scope

- Ledger-server auto-start (deferred, needs a DoD exception).
- Increments 5–7.
- Any change to fabric/sandbox-dev behaviour.
