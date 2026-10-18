# backend-validation — auto-approve

Backend (extension) work. The acceptance criteria are proven by unit tests plus a manual TUI list.

## Commands run

```
$ npx tsc --noEmit                      # exit 0
$ npm run check                         # exit 0
  178 pass / 0 fail / 793 expect() calls
  Ran 178 tests across 31 files.
  Package manifest and public assets validated (11 extensions).
  Local-first enablement validated (11 extensions enabled here).
```

## Criteria each command proves

| Criterion | Proof |
|---|---|
| Shell `confirm` + Jev `none` → auto-approve with notify | `autoprocess.test.ts` (a): `notifications` contains `auto-approved bash … Jev: safe`, result `undefined` |
| Shell `confirm` + Jev `deny` → block | (b): `result.block === true`, reason `destructive rm`, `confirmCalls` 0 |
| Shell `confirm` + Jev `ask` → exactly one human confirm | (c): `confirmCalls` length 1 |
| Non-shell confirm unchanged, no Jev call | `non-shell confirm stays deterministic…`: `jevDecisionCalls` 0, `confirmCalls` 1 |
| Jev transport failure fails closed | `shell-confirm transport failure fails closed…`: `confirmCalls` 1 |
| Single-prompt coordination | `shell-confirm marks the approval handled…`: `markShellApprovalHandled` recorded the tool-call id |
| Plan safe → auto-approve (anchor armed) | (d): tool result contains `Auto-approved`, audit `sandbox-dev-gate` message sent, `agent_before_settle` continues with `ANCHORED OUTCOME` |
| Plan risky / error → human gate (fail closed) | (e) + `risky answers present the human gate`: result contains `Gate presented` |

## Manual TUI check list (run in Pi after `/reload`)

1. Run a harmless shell command that the deterministic policy flags (e.g. `curl https://example.com`,
   `npm install` inside cwd). Expect: a `sandbox-dev: auto-approved bash (Jev: safe)` notify line,
   and the command runs with no approval prompt.
2. Run a risky command (`rm -rf <some-dir>` beyond the ask). Expect: a single permission prompt
   (from either `sandbox-dev` or `jev`, never both).
3. Call `dev_request_approval` on a low-risk plan. Expect: `Auto-approved <task> …` result, the
   status shows the anchored outcome, and the agent proceeds without a chat reply.
4. Call `dev_request_approval` on a plan with an irreversible step. Expect: the human gate shows.
5. Temporarily point `PI_JEV_HARNESS_DIR` at a missing directory. Expect: shell confirms fall back
   to the human prompt (never silently allow).

## Security review (one line per class)

- auth/authorization: the change only widens *when* Jev can auto-approve; unsafe/uncertain still reach the human, and every auto-approval is audited in the transcript.
- credential/secret handling: `askJev` reads the bearer key from env/`~/.jev-harness/credentials` and sends it only as a `Authorization` header; it is never logged or echoed.
- injection (eval/exec/shell): `runJevDecision` spawns `bun <fixed adapter path> <fixed event>` with no user-controlled argv; `askJev` POSTs to the configured endpoint only.
- unsafe deserialization: `JSON.parse` of adapter stdout is the existing, bounded jev-harness contract.
- HTML/`dangerouslySetInnerHTML`: not applicable (terminal UI, no HTML injection surface).
