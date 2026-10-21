# Purpose

Auto-approve safe approval prompts using Jev (TypeSafe System One). Today every approval prompt
interrupts the human; after this change the agent self-approves actions and plans Jev judges safe,
and escalates only unsafe or uncertain ones. **Jev's codebase is not modified** — this package
calls it (the existing adapter for shell safety, the decisions endpoint for plan safety), reads
the result, and takes the allow/ask/deny decision locally.

## Original Ask

Every prompt that Pi asks for me to approve. If this is safe, agent should approve itself, use
jev-harness skill and agent based questions to decide that.

Clarified (human answers, 2026-10-18):

- Scope: **all** approval prompts — tool-call confirmations AND the sandbox-dev plan gate.
- Unsafe/uncertain fallback: **still ask the human** (do not silently block risky-but-legitimate
  work).
- Constraint (t-feedback): **do not touch Jev's codebase** — call it, get the result, decide here.

## Complexity and the reason behind it

**3 / 5.** Two existing extensions (`sandbox-dev`, `jev-gate`) already implement the approval
surfaces; this changes *when* the human is consulted rather than building new surfaces. It adds a
thin Jev HTTP client in this repo and touches a safety-critical permission path, so verification
matters. No external codebase changes.

## Architectural changes required

Introduce one rule, applied to every approval prompt: **Jev is the safety oracle; this repo takes
the decision.**

- `Jev says safe` → auto-approve (the agent proceeds; the human is not interrupted).
- `Jev says unsafe` (deny) → block.
- `Jev says uncertain/risky` (ask) → fall through to the existing human prompt.

Two approval surfaces are unified under this rule:

1. **Tool-call confirmations.** `sandbox-dev/policy.ts` returns deterministic verdicts
   (`allow`/`confirm`/`deny`). Its `confirm` verdicts are currently always `ctx.ui.confirm()`.
   For shell commands, a `confirm` verdict is resolved by the **existing** jev-harness
   `shell-safety` adapter (`bun <jev-harness>/adapters/pi/run.ts pre_tool`), which already returns
   deny/ask/none: `none` (safe) → allow, `deny` → block, `ask` → human confirm. Non-shell
   `confirm` verdicts (path outside cwd) are out of scope and keep prompting.
2. **The plan gate.** `dev_request_approval` currently always presents the human gate. It now
   first asks Jev directly (a local `plan-safety` question set over `taskFindings.md`): safe →
   auto-approve (arm the anchor, notify, tell the agent to proceed), risky/unsafe → present the
   human gate exactly as today.

**Single-prompt and fail-closed invariants (hard requirements):**

- *Exactly one* `ctx.ui.confirm` per tool call. `sandbox-dev` and `jev-gate` both register a
  `tool_call` handler and both currently prompt on overlapping verdicts (e.g. a risky `rm -rf`).
  After this change there must be a single shell-safety resolution per call — the shared bridge
  memoizes the Jev verdict per tool-call id, and exactly one handler owns the `confirm` prompt.
- *Fail closed when Jev is unavailable.* If the adapter subprocess or the Jev endpoint errors,
  times out, or returns non-JSON, the deterministic `confirm` floor still applies: the human
  prompt shows (never a silent allow). Only an explicit safe answer downgrades a deterministic
  `confirm` to allow.
- *Auto-approvals are auditable.* Every auto-approve (tool call or plan) emits a one-line
  `ctx.ui.notify` and, for the plan gate, a `custom_message` entry recording that Jev approved
  and the agent is authorized — so the transcript remains the record.

## Backend changes required

All changes are in this repository. No changes to `~/.claude/skills/jev-harness/`.

1. **`extensions/shared/jev.ts` (new)** — two pure functions:
   - `runJevDecision(eventName, payload)` — the adapter bridge moved out of `jev-gate`: spawn
     `bun <HARNESS_DIR>/adapters/pi/run.ts <eventName>`, JSON payload on stdin, resolve the
     verdict JSON, neutral `{}` on timeout/error/non-JSON. Reuses the existing `shell-safety`
     decision for free.
   - `askJev(state, questions)` — a minimal direct Jev client mirroring jev-harness's wire
     contract (read `~/.jev-harness/config.json` for `endpoint`/`apiKeyName`/`model`/`timeoutMs`;
     read the bearer key from env then `~/.jev-harness/credentials`; POST `{ model, state,
     questions }` with `Authorization` + `X-Deadline-Ms`; return `{ answers, model, inputTokens }`
     or throw). Used only by the plan gate. No logging/ledger in this thin client (read-only; the
     extension takes the decision locally).
2. **`extensions/jev-gate/index.ts`** — use `shared/jev.ts` `runJevDecision` instead of its inline
   runner. No behavior change (it already maps `ask`→confirm, `deny`→block, `none`→allow).
3. **`extensions/sandbox-dev/policy.ts`** — no signature change; add a pure helper
   `isShellConfirm(call)` so `index.ts` knows when a `confirm` verdict is shell-shaped and
   therefore Jev-resolvable.
4. **`extensions/sandbox-dev/index.ts`**
   - In the `tool_call` handler, when `classifyToolCall` returns `confirm` and the call is a
     shell command: call `runJevDecision("pre_tool", { sessionId, cwd, tool: {kind:"shell",
     command, description} })`. Map the merged `gate.action`:
     - `deny` → block (existing deny path).
     - `ask` → `ctx.ui.confirm(...)` (existing human path).
     - `none`/absent → allow (auto-approve) + one-line `ctx.ui.notify` recording the
       auto-approval.
   - Non-shell `confirm` verdicts and deterministic `deny` verdicts keep their current behavior.
   - In `dev_request_approval.execute`: after reading the plan and extracting the outcome, build a
     local `plan-safety` question set and call `askJev`:
     - `safe` (per local thresholds) → set `pendingAnchor`, call `armAnchor(ctx)`,
       `ctx.ui.notify("sandbox-dev: auto-approved <task> (Jev: safe)")`, append a `custom_message`
       recording the auto-approval, and return a result telling the agent it is approved and may
       implement (no stop).
     - `risky`/`unsafe`, or any `askJev` error → present the gate exactly as today
       (`presentGate`). Fail **closed**.
   - `before_agent_start` prompt injection: when auto-approved, the injected note must say the
     outcome is anchored and implementation is authorized (instead of "wait for the human").

No dependency changes; `typebox` and the existing peer deps suffice.

## Frontend changes required

None beyond existing status notifications (`ctx.ui.notify`, `ctx.ui.setStatus`). No new TUI
components; the plan gate stays conversational and the tool confirms stay `ctx.ui.confirm`.

## Acceptance Criteria

1. A safe shell command that `sandbox-dev` would previously `confirm` (e.g. `curl <readonly url>`,
   `npm install` inside cwd) is auto-approved with a visible notify line and executes without a
   human prompt.
2. A destructive command Jev judges unsafe (`rm -rf` beyond the ask) is still blocked; a
   genuinely uncertain/risky command still prompts the human — and exactly once (no double
   prompt from `sandbox-dev` + `jev-gate`).
3. `dev_request_approval` for a low-risk plan auto-approves (anchor armed, status shows the
   outcome) and the agent proceeds without a human chat reply.
4. `dev_request_approval` for a risky plan (irreversible step / auth change) still presents the
   human gate; the transcript records the human reply as before.
5. Jev failure/error at either surface fails **closed** (human prompt/gate shows), never silently
   auto-approves.
6. `npm run check` stays green (typecheck + tests + manifest), with new/changed tests covering the
   shell-confirm→Jev mapping and the plan-gate safe/ask/deny routing.

## Validation

- Unit tests (Bun): pure routing logic — `confirm`+`none`→allow, `confirm`+`deny`→block,
  `confirm`+`ask`→confirm, plan `safe`→auto-approve, plan `risky`/`deny`/error→gate. Inject a fake
  `runJevDecision`/`askJev`; no network in tests.
- Manual TUI check (written list): run a harmless `curl`/`npm install` and observe auto-approval;
  run a risky command and observe the human prompt; call `dev_request_approval` on a sample
  low-risk plan and a sample risky plan and observe auto-approve vs gate.
- `npm run check` exit code and test summary line echoed into the transcript.
