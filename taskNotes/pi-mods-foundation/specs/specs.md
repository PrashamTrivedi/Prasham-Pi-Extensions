# Specs — pi-mods foundation

Parent plan: `taskNotes/pi-mods-foundation/taskFindings.md`
Full design: `docs/pi-mods-plan.md` (§4 Phase 0, §5 Phase 1, §6 Phase 2/§6.1).

Three specs, ordered so each leaves the tree green. Spec A is a prerequisite
(the completion commit cannot proceed on a checker that hardcodes a count).
Specs B and C are independent of each other, but C imports B's types.

| # | Spec | Deliverable | Depends on | Plan |
|---|------|-------------|-----------|------|
| A | Package-check hardening + baseline hygiene | count-free `check-package.mjs`; resolved dirty tree | — | `specs/spec-a-package-check/taskFindings.md` |
| B | `shared/` library | `extensions/shared/{config,state,usage,ledger,ledger-server,index}.ts` + tests | A (commit) | `specs/spec-b-shared-library/taskFindings.md` |
| C | `usage/opencode-go.ts` reporter | provider reporter + live-payload fixture + tests | B (types) | `specs/spec-c-opencode-go/taskFindings.md` |

## Sequencing

```
A (checker + baseline commit) ──→ B (shared + tests) ──→ C (opencode-go + fixture) ──→ npm run check
```

## Cross-cutting rules (apply to all specs)

- Stay in-repo. No subprocess execution anywhere in `shared/` or `usage/`.
- Tests run under `bun test`; extensions run under Node via Pi. Keep
  runtime-specific builtins (e.g. `bun:sqlite`) **out** of the extension import
  graph: the Jev ledger is read through a Bun-run local server
  (`ledger-server.ts`), and the Node side is a plain HTTP client.
- No `as any` / `as unknown as` in new code.
- Each spec ends with its own tests green; the parent run's final proof is
  `npm run check` exiting 0 with 0 test failures.

## Out of scope (all specs)

- Registering any extension entry (`usage/index.ts`, `workbench`, `duck`, `jev`).
- Refactoring `extensions/sandbox-dev/` onto `shared/config.ts`.
- Any TUI rendering or interactive behaviour.
