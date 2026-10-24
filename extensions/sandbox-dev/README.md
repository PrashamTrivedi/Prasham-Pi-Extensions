# sandbox-dev (Pi)

Native Pi port of the ideas behind Claude Code's `sandbox-dev` workflow. The prose lives in
`skills/sandbox-dev/SKILL.md` and `prompts/*.md`; this extension supplies the executable parts
markdown cannot.

## Targets

1. **Permission floor.** A short allow/confirm/deny policy enforced on `tool_call` and `user_bash`,
   fail-closed when there is no UI. A pattern is a case-insensitive substring, or a `/regex/` when
   slash-delimited. Reads are never confirmed — only the protected-path denies restrict them.
   Writes are allowed inside the working directory and under a small set of roots (`~/.pi/agent`,
   `/tmp`, plus `PI_SANDBOX_ALLOW_ROOTS`), and confirmed anywhere else. The `bash.confirm` list is
   limited to destructive or shared-state commands (`sudo`, `rm -rf`, `rm -r`, `git reset --hard`,
   `git push`, `chmod`, `chown`, `* publish`), matched on token boundaries so a command that merely
   mentions a pattern does not match; installs and network calls are left to Jev. Shell `confirm`
   verdicts are resolved through Jev (the `jev-gate` shell-safety decision via `shared/jev.ts`): a
   safe command auto-approves (with a notify line), a destructive one is blocked, and a
   risky/uncertain one — or an unavailable Jev — falls through to the human confirm. Non-shell
   `confirm` (path outside cwd) stays deterministic.
2. **Conversational plan gate.** `dev_request_approval` reads `taskNotes/<task>/taskFindings.md`
   from disk, asks Jev (`shared/jev.ts` `askJev`) whether the plan is safe to implement autonomously,
   and either auto-approves (anchors the outcome, records a `sandbox-dev-gate` audit message, and
   tells the agent to proceed) or appends the gate to the chat for the human. The human answers in
   the transcript (**`g`** / **`t: <feedback>`** / **`r`**); the chat is the record. Any Jev failure
   fails closed to the human gate.
3. **Single-outcome anchoring.** The plan's `Original Ask` is the anchored outcome. Supervision arms
   on the first source write after the gate, restates the outcome each turn, enforces a turn budget,
   and stops when `dev_outcome_met` records evidence. Running out of budget is tracked separately and
   is **not** a satisfied outcome.

## Commands and tools

| Name | Kind | Purpose |
|---|---|---|
| `dev_request_approval` | tool | Read the plan and append the gate to the chat |
| `dev_outcome_met` | tool | Declare the outcome met with raw evidence |
| `/dev-approve <task>` | command | Explicit human approval; anchors and starts `/startWork` |
| `/dev-status` | command | Show the anchored outcome, `met`/`exhausted`, turn budget, and the session's confirm counters |
| `/dev-reset` | command | Clear the in-session gate and anchor |

## Approval flow

1. The model calls `dev_request_approval`, or the human starts the flow with `/codePlanner`.
2. The extension asks Jev whether the plan is safe to implement autonomously. If safe, it
   auto-approves (anchor armed, audit `sandbox-dev-gate` message recorded) and tells the model to
   proceed — no human reply is needed. If risky, uncertain, or Jev is unavailable, it appends a
   `sandbox-dev gate` message to the transcript and stops.
3. The human replies **in the chat** for the risky case. That reply is a normal turn the agent
   reads; the transcript is the record.
4. `/dev-approve <task>` is an explicit human command: it anchors the outcome and starts `/startWork`.

## Configuration

None at the file level. The policy is built in (`DEFAULT_CONFIG` in `policy.ts`). A project-local file
that could zero the `deny` lists would make the floor unenforceable, so there is no config file.

The only knob is `PI_SANDBOX_ALLOW_ROOTS`: a path-separator-delimited list of extra roots where a
`write`/`edit` needs no confirmation (it only relaxes `confirm`, never `deny`). Defaults are the Pi
agent directory (`~/.pi/agent`) and `/tmp`.

`/dev-status` prints `policy: N confirm(s), M auto-approved (Jev)` — the before/after instrument for
the confirm tier. Counters reset on session start and `/dev-reset`.

## Session entries

- `sandbox-dev-outcome` — `{ task, met, evidence, at }`
- `sandbox-dev-anchor` (custom message) — the restated anchor
- `sandbox-dev-gate` (custom message) — the chat gate prompt

## Limits

Policy, not a security boundary: a permitted `bash` call can do anything the Pi process can. The gate
is conversational — the agent follows the skill and the transcript is the audit trail, but nothing
mechanically refuses a source write before approval. Fabric workers run headless with
`--no-extensions`, so none of this is active inside a worker.
