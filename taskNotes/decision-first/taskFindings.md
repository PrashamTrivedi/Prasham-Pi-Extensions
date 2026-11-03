# Purpose

Make the decision server the only judge of every tool call. Nothing is blocked by policy, no pattern
list decides anything, and the human is prompted only when the server does not approve — with a plain
yes/no they can override.

## Original Ask

The latest decisions, verbatim from the answers given in this session:

> **Which calls does the decision server judge?** — *Every tool call (my latest answer).*

> **Do `rm -rf /`-class commands and secret paths keep a deterministic hard block?** — *No hard
> blocks at all (as planned).*

> **When the server rejects and I get a prompt, do you want the "allow for this run" option?** —
> *Plain yes/no prompt.*

> **When the decision server does not approve, what should happen?** — *Always prompt me.*

> **Does this rule apply to shell commands only, or to every tool?** — *All tools uniformly.*

## Superseded decisions (not scope)

These earlier answers are **replaced** by the section above and must not be implemented:

- ~~"Shell + writes only" judged; ordinary reads and other tools skip the server.~~
- ~~3-way prompt with "Allow once" / "Allow for this run" / "Deny" and in-session grants.~~
- ~~`bash.judge` / `paths.judge` / `tools.judge` pattern lists holding the old deny+confirm union.~~

## Complexity and the reason behind it

**3 / 5.** The change deletes the deterministic floor (verdict model, both pattern lists, the
allow-root logic, the shell-approval handshake) and replaces it with one flow: map the call, ask the
server, apply the verdict, prompt on anything that is not an approval. `jev-gate` loses its
`tool_call` handler; the neutral tool mapping moves to a shared module because two extensions now
need it. Four extensions plus docs, skill prose, and four test files. Not 4: no new abstraction
beyond `judgeCall`, no dependency, no persistence, and the verification is unit tests.

## Architectural changes required

1. **One gate, one owner.** `sandbox-dev` is the only extension that judges a `tool_call`.
   `jev-gate` keeps `tool_result` (post-tool / failure-triage / replace / context) and
   `agent_before_settle` (stop / promise-continue), and loses its `tool_call` handler.
2. **No policy.** `classifyToolCall` and every pattern list are deleted. A call is never denied,
   confirmed, or allowed by this package — it is only *judged* by the server. `policy.ts` shrinks to
   the supervision helpers (`isPlanningPath`, `isImplementation`) and `budget`.
3. **The human is the appeal court.** Server approval (`{}` or no `gate`) → run. Anything else —
   `deny`, `ask`, or unreachable — → one plain yes/no prompt carrying the server's reason. No grant
   memory, no persistence, no "allow for this run".
4. **No coordination marker.** `shellApprovalHandled` / `markShellApprovalHandled` in
   `extensions/shared/jev.ts` are dead and removed.
5. **The neutral tool mapping is shared.** `mapToolCall` / `flattenContent` move from
   `extensions/jev-gate/index.ts` to `extensions/shared/tool-call.ts`, because `sandbox-dev` now
   needs the same shape the harness expects.

## Backend changes required

### `extensions/sandbox-dev/policy.ts`

- Delete: `Verdict`, `Decision`, `PolicyConfig` lists (`bash`, `paths`, `tools`), `DEFAULT_CONFIG`
  pattern lists, `VERDICT_RANK`, `matchPattern`, `matchCommand`, `isOutsideCwd`, `isUnderAnyRoot`,
  `writeAllowRoots` (+ `PI_SANDBOX_ALLOW_ROOTS`), `classifyToolCall`, `strongest`, `isShellConfirm`.
- Keep: `budget` (as a plain `export const BUDGET = 8`), `isPlanningPath`, `isImplementation`,
  `IMPLEMENTATION_BASH`.

### `extensions/sandbox-dev/index.ts`

- `pi.on("tool_call")` becomes: arm supervision if needed → `judgeCall`. The only exempt tools are
  `dev_request_approval` and `dev_outcome_met` (the gate machinery already asks the server about the
  plan; judging the tool call would ask twice).
- `judgeCall(ctx, event)`:
  1. `judged += 1`; `runJevDecision("pre_tool", { sessionId, cwd, transcriptPath: process.env.PI_SESSION_FILE, tool: mapToolCall(...) })`.
  2. `verdicts !== undefined` → show every `notify` line, apply `rewrite` to `event.input`; if
     `gate` is absent → `serverApproved += 1`, `notify("decision server: approved")`, run.
  3. `gate.action` `deny`/`ask`, or `verdicts === undefined` → `prompted += 1`, then one
     `ctx.ui.confirm("sandbox-dev permission", "<tool>: <reason>\n\n<300-char preview>")`.
     Approved → run (rewrite already applied). Declined → block `sandbox-dev: denied by you`.
  4. No UI → block with the reason, fail closed.
- `user_bash` (a command the human typed) is **not** judged: it runs as typed. Documented exception —
  it is a human action, not a tool call; prompting someone about their own command is noise. Flagged
  for the reviewer to flip if they disagree.
- Counters `judged` / `serverApproved` / `prompted`; `/dev-status` prints
  `policy: N judged, M server-approved, P prompted`. Reset on `session_start` and `/dev-reset`.

### `extensions/jev-gate/index.ts`

- Delete the `tool_call` handler and its marker check; keep `tool_result` and `agent_before_settle`.
- Import `mapToolCall` / `flattenContent` from `../shared/tool-call.ts` (re-export them so the
  existing `tests/jev-gate/map.test.ts` keeps working).
- Header comment: `sandbox-dev` owns tool-call gating; this extension owns results and stop.

### `extensions/shared/jev.ts`

- Delete `shellHandled`, `markShellApprovalHandled`, `shellApprovalHandled`, and the `jev` bridge
  object entries in `sandbox-dev/index.ts` that exposed them.

### `extensions/shared/tool-call.ts` (new)

- `JevToolCall`, `ToolKind`, `mapToolCall`, `flattenContent` moved verbatim from `jev-gate`.

## Frontend changes required

None. The prompt is `ctx.ui.confirm` (plain yes/no).

## Acceptance Criteria

1. Every tool call except `dev_request_approval` / `dev_outcome_met` reaches `runJevDecision("pre_tool")`
   exactly once — including `read`, `write`, `edit`, `bash`, `mcp__*`, `spawn_agents`, `web_fetch`.
2. No call is blocked by policy: `rm -rf /`, `sudo rm`, `git push --force`, `.env` reads and writes
   all reach the server.
3. Server approval (`{}` or no `gate`) → the tool runs with one info notify and **no prompt**.
4. Server `deny` or `ask` → exactly one plain yes/no prompt showing the server's reason; approve →
   runs; decline → blocked `sandbox-dev: denied by you`.
5. Server unreachable (spawn error, 8 s timeout, non-JSON) → exactly one prompt (fail closed).
6. No grant memory: declining or approving the same command twice prompts twice; nothing is
   persisted to disk or the session file.
7. `rewrite` is applied and `notify` lines are shown on the judged path.
8. `jev-gate` issues no `tool_call` decision and no second server call; its `tool_result` and stop
   behaviour is unchanged.
9. `/dev-status` reports `N judged, M server-approved, P prompted`.
10. No UI → block with the server's reason (fail closed), never a silent run.
11. `npm run check` → 0 failures, typecheck clean.

## Validation

- `tests/sandbox-dev/extension.test.ts`: the four server outcomes (approved / deny / ask /
  unreachable), prompt text and preview, approve vs decline, no-UI fail closed, counters, `/dev-reset`
  reset, `dev_*` exemption, every tool name reaching the server.
- `tests/sandbox-dev/policy.test.ts`: reduced to `isPlanningPath` / `isImplementation`; every deleted
  export's tests removed with it.
- `tests/sandbox-dev/autoprocess.test.ts`: rewrite + notify applied, marker test deleted, `user_bash`
  not judged.
- `tests/jev-gate/map.test.ts`: import moved to `shared/tool-call.ts`; still green.
- `npm run check`; then `/reload` and the manual walkthrough in `taskWalkthrough.md`.

## Specs

`taskNotes/decision-first/specs/specs.md` holds the four specs and their criteria.
