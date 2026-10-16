# sandbox-dev (Pi)

Native Pi port of the ideas behind Claude Code's `sandbox-dev` workflow. The prose lives in
`skills/sandbox-dev/SKILL.md` and `prompts/*.md`; this extension supplies the executable parts
markdown cannot.

## Targets

1. **Permission floor.** A short allow/confirm/deny policy enforced on `tool_call` and `user_bash`,
   fail-closed when there is no UI. A pattern is a case-insensitive substring, or a `/regex/` when
   slash-delimited. This is pass 1 only. The shell-safety pass 2 is owned by `extensions/jev`
   (Phase 5): when it lands it may **escalate** these verdicts, never lower them (`strongest()`).
2. **Conversational plan gate.** `dev_request_approval` reads `taskNotes/<task>/taskFindings.md`
   from disk and appends the gate to the chat. The human answers in the transcript (**`g`** /
   **`t: <feedback>`** / **`r`**); the chat is the record, and the agent reads it. The extension
   records nothing and does not classify the reply.
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
| `/dev-status` | command | Show the anchored outcome, `met`/`exhausted`, and turn budget |
| `/dev-reset` | command | Clear the in-session gate and anchor |

## Approval flow

1. The model calls `dev_request_approval`, or the human starts the flow with `/codePlanner`.
2. The extension appends a `sandbox-dev gate` message to the transcript and stops. It records nothing
   and does not intercept the reply.
3. The human replies **in the chat**. That reply is a normal turn the agent reads; the transcript is
   the record. The agent implements only when the human approves.
4. `/dev-approve <task>` is an explicit human command: it anchors the outcome and starts `/startWork`.

## Configuration

None. The policy is built in (`DEFAULT_CONFIG` in `policy.ts`). A project-local file that could zero
the `deny` lists would make the floor unenforceable, so there is no config file.

## Session entries

- `sandbox-dev-outcome` — `{ task, met, evidence, at }`
- `sandbox-dev-anchor` (custom message) — the restated anchor
- `sandbox-dev-gate` (custom message) — the chat gate prompt

## Limits

Policy, not a security boundary: a permitted `bash` call can do anything the Pi process can. The gate
is conversational — the agent follows the skill and the transcript is the audit trail, but nothing
mechanically refuses a source write before approval. Fabric workers run headless with
`--no-extensions`, so none of this is active inside a worker.
