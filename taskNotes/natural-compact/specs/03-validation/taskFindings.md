# Spec 03 — privacy, measurement and validation

## Purpose
Make the handoff auditable and measurable without overstating what the numbers mean. A summary that replaces live context is a security-relevant artifact: it decides what the model remembers, and it is written to disk.

## Original Ask
Implement the logging, measurement and verification requirements in [requirements.md](../../requirements.md) — full handoff text logged by default with 30-day retention, provider disclosed and configured once — subject to the [main plan](../../taskFindings.md).

## Complexity
3/5. The work is bounded and testable; the risk is quiet failure, not complexity.

## Architectural changes
- **Restricted store.** Approved handoff text plus measurements in a private per-user directory (`0700`/`0600` where applicable), deleted on startup and on write per retention (30 days default), with an explicit opt-out and documented residual copies. Specify symlink and concurrent-write behaviour before writing code, not after.
- **Record shape.** Session id and branch head, timestamp, model and provider, trigger, verdict with reason, work type, chosen `firstKeptEntryId`, `tokensBefore`, post-apply usage, handoff `usage` and `estimatedTokensAfter` when returned, elapsed time, `fromExtension`, and the handoff text. Use null for unknown — never zero — and mark estimated costs as estimated.
- **Honest measurement.** Percent-of-window is not a savings claim. Report the handoff's own cost, the difference in reported context, and the same figures for an ordinary Pi compaction as baseline; note prompt-cache effects and the fact that a rewritten window changes later cache behaviour.
- **Failure policy.** Decide and test whether an unwritable log blocks applying (proposed: block, with a visible, explicit "continue without the audit record" path). A silent logging failure is a privacy regression, not a nuisance.
- **Status surface.** A command that shows configuration, destination and the last measurement without printing handoff content.

## Frontend changes
Disclose provider and data egress *before* generation, not in a settings page. Show configuration errors, logging failures and retention state plainly. Never display handoff text in status output, and never echo credentials from config or errors.

## Acceptance Criteria
- Retention and permissions verified, including on failure and under concurrent writes.
- A handoff that was applied is always represented in the log, or the absence is explicit and recorded.
- Measurement fields distinguish unavailable/estimated/actual, and no document claims savings the measurement does not support.
- The provider and the destination (in-place rewrite of this session) are visible before the call.
- Documentation covers configuration, consent, logging failure, cleanup and what is *not* recoverable.

## Validation
Unit tests over temporary directories with a fake clock: retention deletion, permissions, partial writes, concurrent writers, opt-out, and the block-on-failure path. Manual review of representative new and ongoing handoffs against the recorded transcript for omitted constraints, blockers, tests and next steps. One honest overhead comparison against ordinary compaction, reported with its limitations. `npm run check` for the full repository regression.
