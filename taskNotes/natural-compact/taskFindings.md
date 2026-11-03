# Purpose

Reduce unnecessary conversation context at natural work boundaries **inside the same session**: a reviewed, editable handoff summary replaces the stale span, and the chat continues from it. Continuity is preserved, the unsent draft is never moved, and nothing is deleted — the omitted entries stay in the session file.

This document is a plan, not implementation approval.

## Original Ask

> Work in pi extension repo in ~/Code/ Consult with a higher GPT model.
>
> Update/Create the plan to achieve it

## Destination decision (supersedes earlier plan)

The original design started a **fresh session** from a handoff. After checking the installed Pi API, the destination changes to **in-place continuation via custom compaction**. The underlying product requirements remain in [requirements.md](requirements.md), with the discussion in [brainstorm.md](brainstorm.md); the human decisions that still bind are: interactive first; boundary judgment via decision-server → Jev → ask the human; handoff text logged by default for 30 days; handoff provider configured once; 50% quiet opportunity, 60% active ask; explicit approval; read-only generation; approved-only fallback compaction.

**Why the change.** Pi's context is a projection over a session file, and compaction is the supported way to rewrite that projection: `compact()` appends a `CompactionEntry` (summary + `firstKeptEntryId`) and the window is rebuilt from it, while skipped entries remain stored. An extension can supply that summary itself through `session_before_compact`. That makes continuation a first-class operation rather than a workaround, and it removes three problems the fresh-session path could not avoid:

- **No session switch, so no command-only constraint.** `compact()` is on the base `ExtensionContext`; `newSession()`/`fork()`/`switchSession()`/`navigateTree()` are command-only. The 60% active ask becomes implementable instead of blocked.
- **No editor transfer, so no draft-restoration problem.** The pending request is already in the editor and never leaves it. There is nothing to persist, stage, restore, or verify byte-for-byte.
- **No second session, so no parent link and no resumability proof.** Same file, same id, same history; omitted entries remain stored rather than orphaned.

**What it costs.** The plan now depends on Pi's compaction contract instead of Pi's session lifecycle: the custom summary must carry the structured file-tracking `details` and survive repeat compaction, and the rewrite happens *inside a chat the human is reading*, so the review gate matters more, not less. These are Gate 0 items below.

**Deferred, not rejected:** a fresh session as a second destination for genuinely new work. It stays out of v1 because it alone carries the unproven editor-restoration and persist-without-turn joints.

## Complexity and the reason behind it

**4/5.** Lower than the previous 5 because two of the four feasibility unknowns disappear. Still high because the feature overrides a core Pi mechanism in place: a bad summary degrades a live conversation, repeated compaction and file-tracking `details` must stay coherent, the boundary verdict through decision-server is still unproven, and approval must bind to a snapshot that a human can change by typing.

## Evidence and constraints

Verified by reading the installed package (`dist/core/extensions/types.d.ts`, `dist/core/compaction/compaction.d.ts`, `docs/compaction.md`). Signatures are facts; behaviour under real use is unproven until Gate 0.

- `compact(options?: CompactOptions)` is on `ExtensionContext` ("trigger compaction without awaiting completion"). `CompactOptions = { customInstructions?: string; onComplete?(result): void; onError?(error): void }` — an extension-initiated compaction can pass instructions and observe the outcome without polling.
- `session_before_compact` provides `preparation` (`messagesToSummarize`, `turnPrefixMessages`, `previousSummary`, `fileOps`, `tokensBefore`, `firstKeptEntryId`, `settings`), `branchEntries`, `customInstructions`, `reason: "manual" | "threshold" | "overflow"`, `willRetry`, `signal`. It may cancel or return `{ compaction }`.
- `CompactionResult = { summary, firstKeptEntryId, tokensBefore, estimatedTokensAfter?, usage?, details? }`; `CompactionDetails = { readFiles: string[]; modifiedFiles: string[] }`. A custom summary that omits `details` silently loses Pi's file tracking.
- `session_compact` and `session_compact_failed` both carry `fromExtension` and `reason`, so an extension can tell its own compaction from Pi's automatic one.
- After compaction the window is `summary` + entries from `firstKeptEntryId`; omitted raw entries remain stored but no longer contribute to context, cut selection, summaries, checkpoints or token estimates. Repeated compaction starts at the previous kept boundary and receives `previousSummary`.
- `isIdle()`, `hasPendingMessages()`, `getContextUsage()` (percent nullable) and `sessionManager` are available in the extension context.
- `docs/decision-server.md` documents tool-event decisions, not natural boundaries. `extensions/shared/jev.ts` `runJevDecision` returns a generic verdict, and an empty adapter result means "no matching decision" — **not** proof a boundary was checked. Do not silently replace the decision-server → Jev chain with direct `askJev`.
- Upstream `examples/extensions/handoff.ts` uses `newSession` with a combined draft. That is evidence for the deferred path, not for this one.
- Repository rules: `extensions/natural-compact/` registered in `package.json`; `npm run check` enforces typing, tests and local registration; follow `AGENTS.md` and leave unrelated modified files untouched. Privacy, retention (30 days default) and provider-disclosure requirements from [specs/03-validation](specs/03-validation/taskFindings.md) still apply — the specs predate this destination change and must be re-derived before use.

## Architectural changes required

### Gate 0 — prove the mechanism before building the product

1. **In-place handoff, end to end, in real Pi TUI.** From a settled idle session, call `compact()` with our instructions; have `session_before_compact` return a fixed handoff as `summary` with a chosen `firstKeptEntryId`. Then observe: exactly what the next turn's context contains; that no turn ran on apply; that the editor kept its draft, caret and unsent state; that scrollback and search above the seam are intact; that the session survives reload; and that `/tree` can return to the pre-cut span. Record Pi version, paths, and observed input/output.
2. **Prove Pi's compaction contract is not degraded.** Confirm `details.readFiles`/`modifiedFiles` round-trip into the `CompactionEntry` and keep tracking reads and edits; confirm what happens when Pi's own threshold compaction fires after ours — whether the handoff becomes `previousSummary` and gets re-summarized, and whether that is acceptable or must be intercepted; confirm `fromExtension` distinguishes our invocation; confirm `{ cancel: true }` and abort/error leave the session exactly as before. Decide and document the policy for threshold compactions the extension did not initiate.
3. **Prove the boundary + work-type verdict.** A typed, explicitly applied decision through decision-server using Jev returning `verified`, `not_boundary`, or `uncertain`, plus work type and reason. `uncertain` escalates to the human; human boundary confirmation is not apply approval. Establish ownership, deployment, logging and cost of any adapter change outside this repo. Never infer `verified` from a generic `{}`.
4. **Prove what "reversible" means here.** Establish concretely how a human inspects or recovers a handoff they regret: tree navigation, the compaction entry in the transcript, or neither. If the answer is "not recoverable without editing the file", say so in the review UI and in the acceptance criteria instead of claiming reversibility.

Record raw results and a go/no-go per item. If a hard requirement cannot be met, stop that path and present the limitation — do not silently downgrade to ordinary compaction.

### Gate 1 — build only on proven contracts

- Add `extensions/natural-compact/` (registered locally per `AGENTS.md`) with a pure eligibility/state machine separated from Pi adapters. States: `idle → candidate → adjudicating → offered → generating → reviewing → approved → applying → cooling`. One candidate at a time; declines, vetoes, aborts and failures return to `idle` with a reason. A changed branch head invalidates any approval. Session-scoped state clears on shutdown; branch-scoped state re-derives on resume.
- **Eligibility.** Measure `getContextUsage()` against the reported window and keep raw tokens, window and model identity; unknown/null/stale usage means no automatic threshold decision. Require `isIdle()`, no pending messages, and a stable branch head immediately before review and again immediately before apply. At ≥50% and <60%, show a non-disruptive verified opportunity accessible from a command; at ≥60%, actively ask at the next verified boundary. Never interrupt an active tool run. After a decline, require both a new boundary identity and the configured cooldown (proposed 15 minutes, to confirm) before asking again.
- **Judgment.** Apply decision-server → Jev → user per the proven protocol. Confident negative waits; uncertain or disagreement escalates; unavailable, malformed or timed-out is never an approval. The judge also names the work type, which now selects the handoff template and the keep-tail policy rather than a destination.
- **Review.** Show reason, work type, editable handoff, and the cut point — "keep the last N turns" versus "keep none" — as an explicit, visible choice. Decline and edit are first-class. Approval binds the exact handoff text, the session file, the branch head and the chosen `firstKeptEntryId`. The editor's contents are **not** part of the binding: nothing is transferred, so typing while reviewing is harmless. Any new session entry invalidates the approval.
- **Generation.** Lazy: the scribe runs only when the human opens review, so a declined ask costs nothing. Provider configured once and disclosed; prefer an available OpenCode Go Flash model and ask for configuration otherwise — never substitute silently. Read-only by construction (tool-free, or a restricted read interface with an allow-list and byte cap). Bounded input: active branch only, oldest turns elided first, tool output truncated, prior compaction summary included as context. Untrusted transcript and file text are delimited as data and cannot act as instructions. Output must use the mode's template, preserve uncertainty, never invent tests, and return file-tracking blocks that map to `details`.
- **Apply.** Re-check idle, pending messages and branch head, then `compact({ customInstructions })` and have the pending invocation answered by `session_before_compact` returning `{ summary, firstKeptEntryId, tokensBefore, estimatedTokensAfter?, usage?, details: { readFiles, modifiedFiles } }`. Use `onComplete`/`onError` plus `session_compact` / `session_compact_failed` (`fromExtension`) to advance the state machine. Never submit, clear or rewrite the editor. On error, abort or cancellation, leave the session untouched and report it.
- **Fallback.** "Offer ordinary Pi compaction" now means: do not intercept — let Pi's built-in summarizer run, with its own explicit approval. Make that distinction visible in the UI so a fallback cannot be mistaken for a handoff.
- Command surface: `/natural-compact` initiates or reviews an eligible candidate; a status command inspects configuration and the last measurement without exposing handoff text.

## Backend changes required

- Local configuration for provider, cooldown, default tail, retention and privacy controls, following repository conventions. No secrets in configuration or error text.
- Restricted local log of approved handoff text plus measurements: private directory with `0700`/`0600` where applicable, 30-day retention default, deletion on startup and write, explicit opt-out, documented residual copies. Concurrent-write and symlink handling specified in implementation.
- Record: session id and branch head (avoid raw paths where unnecessary), timestamp, model and provider, trigger, verdict and reason, work type, cut point, context before (`preparation.tokensBefore`) and after (`getContextUsage()`), handoff `usage` when returned, elapsed time, and the handoff text itself. Distinguish unavailable from zero and estimated from billed; note prompt-cache effects. Never capture raw transcript or credentials, and make no savings claim from a percentage alone.
- Define and test whether a logging failure blocks applying (proposed: block by default, with a visible, explicit "continue without the audit record" path).

## Frontend changes required

TUI only for v1. Provide: unobtrusive 50% status; 60% review prompt at a proven safe boundary; boundary-uncertainty question; editable handoff with the cut point visible; explicit apply/decline; progress and error states during `compact()`; cooldown feedback; a clear seam marker afterwards; and, wherever Gate 0 shows it exists, a way to inspect or recover the pre-cut span. Keyboard accessible, existing editor content preserved, no auto-submit. No changes to web UI. RPC/JSON/print do not apply anything in v1.

## Acceptance Criteria

1. Gate 0 passes with recorded observations in real Pi TUI, or the team stops and documents the blocker instead of claiming completion.
2. At 49%, 50%, 59% and 60%, behavior matches the thresholds and still requires a verified boundary; unknown usage produces no threshold decision; an active run or queued message is never interrupted.
3. A model proposal is actually checked through a demonstrated decision-server/Jev contract. Negative, uncertain, malformed, missing, timed-out and conflicting outcomes are distinguished; uncertainty asks the human; no unverified verdict is treated as verified; boundary confirmation is separate from apply approval.
4. The human sees the reason, the work type, the editable handoff and the cut point; decline is remembered. Nothing is applied without its own approval, and fallback summarization needs a separate approval.
5. After applying, the next turn's context is exactly the approved summary plus entries from the chosen `firstKeptEntryId`. The editor is byte-identical and unsent. Omitted entries remain stored, scrollback and search above the seam behave as Gate 0 recorded, and a stale snapshot, abort, error or cancel leaves the session unchanged with no duplicate or orphaned state.
6. `details.readFiles` and `details.modifiedFiles` are present and consistent with the transcript, and a later threshold compaction either preserves the handoff or deliberately regenerates it per a documented, tested policy.
7. Provider configured once and disclosed; no silent substitution; generation has no mutating capability; new/ongoing templates contain their specified fields and never claim work that was not done.
8. Restricted local logs include handoff text by default, expire per configurable retention, and make unknowns explicit. Configuration, logging failure and cleanup are documented and tested.
9. Existing extension registration, docs, automated tests, typecheck and repository package checks pass. Non-TUI modes do not apply a handoff.

## Validation

- Real-Pi TUI script with observed input/output, Pi version, session path, before/after `getContextUsage()`, and evidence that no turn ran and the draft survived; include reload and a post-apply threshold compaction.
- `bun test tests/natural-compact` for pure state transitions, threshold edges, cooldown on a fake clock, snapshot invalidation on a new entry, cancel/abort/error paths, cut-point selection, `details` round-trip, repeated-compaction policy, decision-server contract with mocks (including a simulated `{}`), provider selection, access controls, log permissions and retention.
- `npm run check` for typing, full test regression and local package registration; then load and use it here before any promotion.
- Exercise representative new and ongoing transcripts; compare total reported usage and latency, including handoff overhead, against ordinary Pi compaction without claiming savings the measurement does not show.

## Deferred / decisions to confirm

- Fresh-session destination for new work (command-only, editor restoration and persist-without-turn unproven). Not in v1.
- Cooldown default and whether it is wall clock, a boundary count, or both.
- Default tail policy and its UI wording; whether the cut point may be "keep none".
- Policy for threshold compactions the extension did not initiate: pass through, intercept, or regenerate.
- Approval transport and timeouts for automated/RPC sessions.
- Fallback on a failed log write; retention cleanup schedule; ownership and deployment of the decision-server boundary adapter.
