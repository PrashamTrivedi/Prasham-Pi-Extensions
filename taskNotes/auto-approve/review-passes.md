# review-passes — auto-approve

Bounded review-fix loop over the implemented diff (subagent patch + orchestrator fixes).

## Pass 1 (deep)

Findings: **2**

1. **Shell fail-open on Jev transport failure.** `runJevDecision` resolved `{}` for both a safe
   verdict and a subprocess timeout/error, so `gate?.action !== "ask"` treated "Jev unavailable"
   as "safe" and auto-approved. → Fixed: `runJevDecision` now resolves `undefined` on transport
   failure; `sandbox-dev` maps `undefined` to the human confirm (fail closed).
2. **Double prompt.** `sandbox-dev` and `jev-gate` both registered `tool_call` and both prompted
   on a shell `ask` verdict. → Fixed: `sandbox-dev` marks the tool-call id handled
   (`markShellApprovalHandled`); `jev-gate` skips its shell-safety gate for handled ids.

## Pass 2 (confirm fixes, catch regressions)

Findings: **0**

- Verified the transport-failure path and the handled-flag path with two new tests
  (`shell-confirm transport failure fails closed…`, `shell-confirm marks the approval handled…`).
- Verified `npx tsc --noEmit` exit 0 and `npm run check` exit 0 (178 pass / 0 fail).

Terminated by: **zero findings** after 2 passes.
