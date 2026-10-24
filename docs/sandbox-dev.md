# sandbox-dev

A native Pi port of the ideas behind Claude Code's `sandbox-dev` workflow. The prose lives in
`skills/sandbox-dev/SKILL.md` and `prompts/*.md`; the extension supplies only the executable
parts that markdown cannot. See [extensions/sandbox-dev/README.md](../extensions/sandbox-dev/README.md)
for the full reference.

## Targets

1. **Permission floor** — a short allow/confirm/deny policy over `tool_call` and `user_bash`,
   fail-closed with no UI. A pattern is a case-insensitive substring, or a `/regex/`; the
   `bash.confirm` tier matches on token boundaries and covers only destructive or shared-state
   commands. Reads never confirm, and writes are allowed inside cwd and the roots in
   `PI_SANDBOX_ALLOW_ROOTS` (default `~/.pi/agent` and `/tmp`).
2. **Conversational plan gate** — `dev_request_approval` appends the gate to the chat; the
   human's reply in the transcript is the record. The extension records nothing.
3. **Single-outcome anchoring** — supervision arms on the first source write, restates the
   outcome each turn, and stops only when `dev_outcome_met` records evidence.

## Commands and tools

| Name | Kind | Purpose |
| --- | --- | --- |
| `dev_request_approval` | tool | Read the plan and append the gate to the chat |
| `dev_outcome_met` | tool | Declare the outcome met with raw evidence |
| `/dev-approve <task>` | command | Explicit human approval; anchors and starts `/startWork` |
| `/dev-status` | command | Anchored outcome, `met`/`exhausted`, turn budget, confirm counters |
| `/dev-reset` | command | Clear the in-session gate and anchor |

## Limits

Policy, not a security boundary: a permitted `bash` call can do anything the Pi process can.
Fabric workers run headless with `--no-extensions`, so none of this is active inside a worker.
