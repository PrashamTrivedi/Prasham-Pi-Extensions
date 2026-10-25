# sandbox-dev

A native Pi port of the ideas behind Claude Code's `sandbox-dev` workflow. The prose lives in
`skills/sandbox-dev/SKILL.md` and `prompts/*.md`; the extension supplies only the executable
parts that markdown cannot. See [extensions/sandbox-dev/README.md](../extensions/sandbox-dev/README.md)
for the full reference.

## Targets

1. **Decision-server gate** — every `tool_call` is sent to the decision server; an approval runs it,
   and a reject, an "ask", or an unreachable server becomes one plain yes/no prompt. Failed closed
   with no UI. Nothing is blocked or pre-approved locally.
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
| `/dev-status` | command | Anchored outcome, `met`/`exhausted`, turn budget, judged / server-approved / prompted counters |
| `/dev-reset` | command | Clear the in-session gate and anchor |

## Limits

The gate's judgement is the decision server's — this package adds none of its own. Every tool call
costs one adapter subprocess plus the harness request, and an unreachable server prompts once per
tool call with no approval memory. Fabric workers run headless with `--no-extensions`, so none of
this is active inside a worker.
