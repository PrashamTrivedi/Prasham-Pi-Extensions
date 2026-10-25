# Specs — decision-first

Four specs, ordered by dependency. Each is a single-file change (Spec 3 touches two small ones), so
its deliverable and criteria live here instead of a separate `taskFindings.md`.

## Spec 1 — Delete the policy (`extensions/sandbox-dev/policy.ts`)

**Deliverable:** the file keeps only the supervision helpers. Every verdict, list, matcher, and
allow-root helper is deleted, along with `PI_SANDBOX_ALLOW_ROOTS`.

**Criteria**
- Gone: `Verdict`, `Decision`, `PolicyConfig`, `DEFAULT_CONFIG`, `VERDICT_RANK`, `strongest`,
  `matchPattern`, `matchCommand`, `isOutsideCwd`, `isUnderAnyRoot`, `writeAllowRoots`,
  `classifyToolCall`, `isShellConfirm`.
- Kept: `BUDGET` (8), `isPlanningPath`, `isImplementation`, `IMPLEMENTATION_BASH`.
- No remaining reference to `PI_SANDBOX_ALLOW_ROOTS` anywhere in the package.

**Tests:** `tests/sandbox-dev/policy.test.ts` rewritten down to the two helpers.

## Spec 2 — Judge flow (`extensions/sandbox-dev/index.ts`)

**Deliverable:** `judgeCall` — one server call per tool call, verdict applied faithfully, one plain
yes/no prompt on anything that is not an approval, new counters.

**Criteria**
- Every tool call except `dev_request_approval` / `dev_outcome_met` calls
  `runJevDecision("pre_tool", …)` exactly once, with `mapToolCall`'s neutral shape.
- No `gate` (or `{}`) → run, `serverApproved++`, one info notify, no prompt.
- `gate.action` `deny` or `ask` → one prompt with the server's reason; approve → run; decline →
  block `sandbox-dev: denied by you`.
- `undefined` (timeout, spawn error, non-JSON) → one prompt (fail closed).
- `notify` lines shown and `rewrite` applied before the gate is evaluated.
- No grant memory: the same command prompts again; nothing is persisted.
- No UI → block with the reason.
- `user_bash` runs as typed (documented exception, human action).
- Counters `judged` / `serverApproved` / `prompted` in `/dev-status`; reset on start and `/dev-reset`.

**Tests:** `tests/sandbox-dev/extension.test.ts`, `tests/sandbox-dev/autoprocess.test.ts`.

## Spec 3 — Single gate cleanup (`extensions/jev-gate/index.ts`,
`extensions/shared/jev.ts`, `extensions/shared/tool-call.ts`)

**Deliverable:** `jev-gate` loses its `tool_call` handler; the neutral mapping moves to
`shared/tool-call.ts`; the shell-approval marker pair is deleted.

**Criteria**
- `jev-gate` registers only `tool_result` and `agent_before_settle`.
- `mapToolCall` / `flattenContent` live in `shared/tool-call.ts`, imported by both extensions and
  re-exported by `jev-gate` so `tests/jev-gate/map.test.ts` stays green.
- No references to `markShellApprovalHandled` / `shellApprovalHandled` anywhere.
- Post-tool replace/context and stop/continue behaviour unchanged.

## Spec 4 — Docs and skill (`README.md`, `docs/sandbox-dev.md`,
`extensions/sandbox-dev/README.md`, `CHANGELOG.md`, `skills/sandbox-dev/SKILL.md`)

**Deliverable:** every place that says "allow/confirm/deny", "deny list", "confirm tier", "respect a
deny", or documents `PI_SANDBOX_ALLOW_ROOTS` describes the new model: every tool call goes to the
decision server, approval runs it, rejection or unreachability prompts the human, and the human's
decline is the only block.

**Criteria**
- No doc claims this package blocks or pre-approves anything.
- The skill says a block now means "the human declined" or "no UI", and that a declined command must
  not be retried.
- CHANGELOG entry records the deletion of the deterministic floor (including `PI_SANDBOX_ALLOW_ROOTS`,
  added one commit earlier) and the plain yes/no prompt.
