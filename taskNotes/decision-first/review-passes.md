# Review passes — decision-first

## Pass 1 — 4 findings

1. **A notify line per approved tool call.** The spec said "approval → one info notify"; with *every*
   tool call judged, that is a notification for every read and edit — exactly the noise this change
   exists to remove. Approval is now silent (the tool call is its own feedback); only harness
   `notify` lines, rewrites, and prompts surface. Docs and the CHANGELOG were corrected to match.
2. **`prompted` counted before the no-UI check.** With no UI nothing is prompted, so the counter
   claimed a prompt that never happened. Moved after the `ctx.hasUI` guard.
3. **Unused `toolCallId` in `judgeCall`'s parameter type.** Dropped; `mapToolCall` does not need it.
4. **`docs/sandbox-dev.md` still titled the target "Permission floor".** Retitled to
   "Decision-server gate" — there is no floor left to speak of.

## Pass 2 — 1 finding

5. **CHANGELOG still promised "one notify line" on approval**, contradicting finding 1's fix.
   Corrected to "runs the call silently".

## Pass 3 — 0 findings

Re-checked the whole diff: no `PI_SANDBOX_ALLOW_ROOTS`, no marker pair, no `classifyToolCall`, no
`user_bash` handler, no allow/confirm/deny prose left in the live docs (`docs/sandbox-dev-pi-migration.md`
and the released CHANGELOG sections are historical records and deliberately untouched). `jev-gate`
registers two hooks; `sandbox-dev` makes exactly one `pre_tool` call per tool call.

**Terminated by zero findings.**

## Security review (diff-level)

- **Auth / authorization:** the plan gate (`dev_request_approval`) and `dev_outcome_met` are exempt
  from judging and unchanged; they remain the only way to arm supervision.
- **Credentials / secrets:** this package holds no protected-path list any more — a `.env` or
  `~/.ssh` read is now judged by the decision server, and a rejection prompts the human. That is the
  approved design, and it means the local floor is exactly as strong as the server's rules.
- **Injection:** no new `eval`/`exec`; the only mutation of `event.input` is the harness-supplied
  `rewrite`, already the pre-existing contract.
- **Failure modes:** server unavailable → prompt (fail closed); no UI → block. No path runs a
  non-approved call silently.
- **Deserialization / DOM escapes:** not applicable.

## Residual risks (accepted, documented in the plan)

- One adapter subprocess plus one harness request **per tool call**.
- No approval memory: a repeated rejection prompts again, and a server outage prompts per call.
- Judgement quality is now entirely the server's; this package cannot soften a rule locally.
