# Spec 01 — feasibility: the compaction contract and the verdict

## Purpose
Prove the in-place handoff and the boundary judgment before any product code exists. Two things are being tested: that Pi's compaction can be driven by an extension without degrading the session, and that a natural boundary can be judged off-session with a typed verdict. Use synthetic data in an isolated session.

## Original Ask
Implement Gate 0 of the [main plan](../../taskFindings.md): a real-Pi demonstration of the compaction mechanism and the decision contract, retaining the human's interactive-first and decision-server → Jev → human escalation choices, with a continuous destination.

## Complexity
5/5. The feature overrides a core Pi mechanism in place, and the judgment half depends on a contract that does not exist yet.

## What to build
A disposable spike — a test-only extension or an unregistered scratch file — driven from the real TUI. No `package.json` registration, no product surface. Reproduce the mechanism in the smallest form that answers the questions below, then throw the code away.

## Investigations

**A. Apply, end to end.** From a settled, idle session, call `compact({ customInstructions })` with a fixed handoff and have `session_before_compact` return `{ summary, firstKeptEntryId, tokensBefore }`. Then record: exactly what the next turn's context contains; whether any turn ran on apply; whether the draft, its caret and its unsent state survived; whether the session survives reload and resume; and what `/tree` does with the omitted span.

**B. The summary contract.** Confirm `details.readFiles` / `details.modifiedFiles` round-trip into the `CompactionEntry` and keep read/edit tracking coherent afterwards. Run a second compaction after the handoff (the threshold one) and record whether the handoff is passed as `previousSummary`, whether it is re-summarized, and what that costs. Confirm `session_compact.fromExtension` distinguishes our invocation, and that `{ cancel: true }`, abort and `onError` leave the session byte-identical.

**C. Threshold policy.** Decide and demonstrate what the hook does when the compaction was **not** initiated by the loop (`reason: "threshold"`): pass through to Pi's own summarizer, intercept with a generated handoff, or refuse. Record the latency and token cost of each, and whether intercepting can fire while a turn is running.

**D. Recoverability.** Establish what the human can actually see and do after a handoff they regret: how the compaction entry renders in the TUI, whether the pre-cut span is reachable by navigation, and what remains in the file. If nothing is recoverable without hand-editing the session file, that becomes an acceptance constraint, not a footnote.

**E. The verdict.** Demonstrate an explicit, applied boundary + work-type decision through decision-server using Jev, returning `verified`, `not_boundary` or `uncertain`, plus work type and reason. A generic adapter result is not evidence — the contract must distinguish "no matching decision" from "verified". Record ownership, deployment, logging, data egress and cost of any adapter change outside this repository. Do not substitute direct `askJev` for the requested chain.

## Acceptance Criteria
- Each investigation marked **proven / blocked / untested**, with the observed calls, Pi version, session paths, input and output recorded verbatim.
- No turn triggered by applying, and the draft unchanged — or the mechanism is blocked.
- `details` preserved across the handoff, or the path is blocked with the degradation named.
- The threshold policy is chosen from evidence, not convenience.
- A verdict is only ever read as verified when the contract says so explicitly.
- If a hard requirement fails, document the options and stop for human direction. No claim of a working implementation, and no silent downgrade to ordinary compaction.

## Validation
Manual real-TUI run with synthetic transcripts; inspect before and after, including a restart; run one post-apply threshold compaction; capture `getContextUsage()` before and after. Probe only authorized decision-server test inputs. Review the recorded evidence line by line rather than trusting a summary of it.
