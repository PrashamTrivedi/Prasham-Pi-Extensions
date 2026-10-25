# Backend validation — decision-first

Work mode: backend (no UI layer; the prompt is `ctx.ui.confirm`).

## Commands run

```bash
$ npm run typecheck
> tsc --noEmit
TYPECHECK_EXIT=0

$ npm run check
 201 pass
 0 fail
 879 expect() calls
Ran 201 tests across 34 files.
Package manifest and public assets validated (12 extensions).
Local-first enablement validated (12 extensions enabled here).
CHECK_EXIT=0
```

## Criteria → proof

| Criterion (`taskFindings.md`) | Proving test |
|---|---|
| 1. Every tool call reaches `runJevDecision("pre_tool")` exactly once, all kinds | `extension.test.ts` › `every tool call reaches the decision server exactly once` (bash, read, write, edit, mcp, spawn_agents, web_fetch → 7 calls, all `pre_tool`) |
| 2. Nothing blocked by policy: root rm, force push, `.env`, `~/.ssh` read | `extension.test.ts` › `nothing is blocked by policy, not even a root rm or a secret read` (4 calls judged, 0 prompts) |
| 3. Approval runs silently | `autoprocess.test.ts` › `approval runs the call silently, with no prompt` (no notifications, no confirm) |
| 4. Reject → one prompt with the reason; approve runs, decline blocks | `autoprocess.test.ts` › `a reject prompts once…`, `a reject plus a decline blocks…`; `extension.test.ts` › `a rejected call asks the human and honors the answer` |
| 5. Unreachable → one prompt (fail closed) | `autoprocess.test.ts` › `an unreachable server prompts instead of failing open` (prompt text contains "unavailable") |
| 6. No grant memory | `autoprocess.test.ts` › `there is no grant memory: the same rejected call prompts every time` (2 prompts, 2 server calls) |
| 7. `rewrite` applied, `notify` shown | `autoprocess.test.ts` › `a rewrite is applied and notify lines are shown` |
| 8. `jev-gate` issues no `tool_call` decision | `tests/jev-gate/hooks.test.ts` › `issues no tool_call decision — sandbox-dev is the single gate`, `keeps the result and stop hooks` |
| 9. `/dev-status` counters + reset | `extension.test.ts` › `/dev-status reports the counters and /dev-reset clears them` |
| 10. No UI → block, never a silent run | `autoprocess.test.ts` › `no UI fails closed with the server's reason`; `extension.test.ts` › `no server answer still prompts, and the gate tools are exempt` |
| 11. Typecheck clean, 0 failures | exit codes above |
| Gate tools exempt; `user_bash` unjudged | `extension.test.ts` › `…the gate tools are exempt` (0 decision calls), `a command the human typed is not judged` (`user_bash` hook absent) |

## Not provable by tests

The real server's verdicts, and the per-call latency. Both need a live session — see
`taskWalkthrough.md`.
