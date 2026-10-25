# sandbox-dev (Pi)

Native Pi port of the ideas behind Claude Code's `sandbox-dev` workflow. The prose lives in
`skills/sandbox-dev/SKILL.md` and `prompts/*.md`; this extension supplies the executable parts
markdown cannot.

## Targets

1. **Decision-server gate.** Every `tool_call` is mapped to the neutral jev-harness tool shape and
   sent to the decision server (`shared/jev.ts` `runJevDecision`). Approval (`{}` or no `gate`) runs
   the call silently — the tool call is its own feedback, and a line per read would be noise. Anything else — `deny`, `ask`, or an unreachable server — becomes
   exactly one plain yes/no prompt for the human, and with no UI it fails closed. Nothing is blocked
   or pre-approved locally: this package holds no dangerous-command list and no protected-path list,
   and it remembers no approval between calls. `dev_request_approval` and `dev_outcome_met` are the
   only exempt tools. Commands the human types with `!cmd` are not judged — they are human actions,
   not tool calls.
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
| `/dev-status` | command | Show the anchored outcome, `met`/`exhausted`, turn budget, and the session's judged / server-approved / prompted counters |
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

None. There is no policy to configure, no pattern list, and no environment variable: the decision
server owns every judgement, and this extension only relays it and asks the human when the server
does not approve.

`/dev-status` prints `policy: N judged, M server-approved, P prompted` — the before/after instrument
for the gate. Counters reset on session start and `/dev-reset`.

## Session entries

- `sandbox-dev-outcome` — `{ task, met, evidence, at }`
- `sandbox-dev-anchor` (custom message) — the restated anchor
- `sandbox-dev-gate` (custom message) — the chat gate prompt

## Limits

The gate's strength is the decision server's: this package adds no judgement of its own. Every tool
call costs one Bun subprocess spawn plus the harness's own request, and a server that is down or slow
produces a prompt per tool call with no memory to quieten it. Policy, not a security boundary: an
approved `bash` call can do anything the Pi process can. The plan gate is conversational — the agent
follows the skill and the transcript is the audit trail, but nothing mechanically refuses a source
write before approval. Fabric workers run headless with `--no-extensions`, so none of this is active
inside a worker.
