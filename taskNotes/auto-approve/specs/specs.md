# auto-approve — spec breakdown

Complexity 3. Three independent spec items, each leaving the tree green. **No jev-harness
codebase changes** — this repo calls Jev and decides locally.

## Spec A — shared Jev bridge (`extensions/shared/jev.ts`)

Move the adapter runner out of `jev-gate` and add a thin direct client.

- `runJevDecision(eventName, payload): Promise<Verdicts>` — spawns `bun
  <HARNESS_DIR>/adapters/pi/run.ts <eventName>`, JSON payload on stdin, resolves parsed verdicts,
  neutral `{}` on timeout/error/non-JSON. `jev-gate` re-imports it; behavior unchanged.
- `askJev(state, questions): Promise<{answers, model, inputTokens}>` — reads
  `~/.jev-harness/config.json` (`endpoint`/`apiKeyName`/`model`/`timeoutMs`) and the bearer key
  (env → `~/.jev-harness/credentials`), POSTs `{ model, state, questions }` with
  `Authorization`/`X-Deadline-Ms`, returns the answers, throws on failure. No ledger writes.
- Tests: inject fake `spawnImpl`/`fetchImpl`; assert neutral on timeout/error/bad JSON and correct
  body/headers on success.

## Spec B — shell-confirm auto-approval

`sandbox-dev` `tool_call` handler: a `confirm` verdict for a shell command is resolved by the
existing `shell-safety` adapter instead of an unconditional prompt.

- `deny` → block (existing path).
- `ask` → `ctx.ui.confirm` (existing path).
- `none`/absent → allow + one-line `ctx.ui.notify` recording the auto-approval.
- Non-shell `confirm` (path outside cwd) and deterministic `deny` are unchanged.
- `policy.ts`: add `isShellConfirm(call)` pure helper.
- Single-prompt invariant: the shared bridge memoizes the Jev verdict per tool-call id so
  `sandbox-dev` + `jev-gate` never both prompt.
- Tests: route mapping with a fake `runJevDecision`.

## Spec C — plan-gate auto-approval (local Jev call, no jev-harness edit)

`sandbox-dev` `dev_request_approval` builds a local `plan-safety` question set and calls `askJev`
before presenting the gate.

- Local state: `{ plan: clip(taskFindings text), task, cwd }`. Local questions (noul):
  `irreversible` (irreversible/hard-to-undo steps), `scope_risk` (auth/secrets/schema or scope
  creep), `safe_autoproceed` (safe to implement fully autonomously).
- Local thresholds: `safe` → auto-approve (`pendingAnchor` + `armAnchor` + notify +
  `custom_message` audit entry + "you may implement" result); `risky`/`unsafe`/any error → gate
  (fail closed). `before_agent_start` note reflects auto-approved state.
- Tests: routing with a fake `askJev`.

See `taskFindings.md` for the full acceptance criteria and validation.
