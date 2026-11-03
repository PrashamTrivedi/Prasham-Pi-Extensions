# Spec 02 — runtime and user experience

## Purpose
Implement the eligibility → judgment → review → apply loop for continuous chat, using only the capabilities proven by Spec 01.

## Original Ask
Implement the interactive-first continuous behavior in [requirements.md](../../requirements.md), following Gate 1 and every acceptance criterion in the [main plan](../../taskFindings.md).

## Complexity
4/5. Asynchronous state, a live-window rewrite, and an approval that a human can invalidate by typing.

## Architectural changes
Add `extensions/natural-compact/` and register it locally per `AGENTS.md`. Keep a pure eligibility/state machine free of Pi imports, with thin adapters for context usage, events, UI and the compaction call.

- **States:** `idle → candidate → adjudicating → offered → generating → reviewing → approved → applying → cooling`, each with a reason on every return path. One candidate at a time. Session-scoped work clears on shutdown; branch-scoped work re-derives on resume.
- **Eligibility:** nullable `getContextUsage()` against the reported window, retaining tokens, window and model. Unknown, null or stale usage means no automatic threshold decision. Require `isIdle()`, no pending messages and a stable branch head at review time and again immediately before apply. At ≥50% and <60% expose a verified opportunity from the command; at ≥60% ask at the next verified boundary. Never interrupt a running tool.
- **Judgment:** decision-server → Jev → user per the proven protocol. A confident negative waits; uncertainty or disagreement escalates as a boundary question, never as an approval; unavailable, malformed and timed-out outcomes are non-approvals. The verdict's work type selects the template and the default tail, not a destination.
- **Review:** reason, work type, editable handoff, and the cut point shown as an explicit choice ("keep the last N turns" / "keep none"). Approval binds the exact handoff text, the session file, the branch head and the chosen `firstKeptEntryId`. **The editor is not part of the binding** — nothing transfers, so typing while reviewing is safe; a new session entry invalidates the approval.
- **Generation:** lazily, only when review opens. Configured-once provider, disclosed before the call; prefer an available OpenCode Go Flash model and ask for configuration otherwise. Read-only by construction. Bounded projection from the active branch, with the prior compaction summary included as context. Transcript and files delimited as data. Two templates; uncertainty preserved; no invented test results; file blocks emitted so the summary can carry `details`.
- **Apply:** revalidate, then `compact({ customInstructions })` with `onComplete`/`onError`, advancing the machine on `session_compact` / `session_compact_failed` filtered by `fromExtension`. Never submit, clear or rewrite the editor. Any error, abort or cancellation leaves the session unchanged and reports why.
- **Fallback:** "offer Pi's ordinary compaction" means *do not intercept*. Show that distinction in the UI and require its own approval.
- **Commands:** `/natural-compact` to initiate or review an eligible candidate; a status command for configuration and the last measurement.

## Backend changes
Local configuration (provider, cooldown, default tail, retention, logging opt-out) with no secrets in config or errors. Logging and metric capture are specified in [Spec 03](../03-validation/taskFindings.md); this spec only emits the events and values they need (`tokensBefore`, post-apply usage, handoff `usage`, elapsed, cut point, verdict, `fromExtension`).

## Frontend changes
TUI only. Unobtrusive 50% status; 60% review prompt at a proven safe boundary; boundary-uncertainty question; editable handoff with the cut point visible; explicit apply and decline with distinct wording; progress and failure states around `compact()`; cooldown feedback; and afterwards a clear seam marker plus whatever recovery Gate 0 established. Keyboard accessible, editor preserved, nothing auto-submitted. No web UI; RPC/JSON/print apply nothing in v1.

## Acceptance Criteria
The runtime criteria in the main plan pass, specifically: threshold edges at 49/50/59/60 with a verified boundary required; unknown usage inert; no interruption of an active run; typed verdict handling with no unverified verdict treated as verified; approval bound to handoff, session, branch head and cut point, invalidated by a new entry; a decline requiring both a new boundary and the cooldown; apply leaving the next context equal to summary + kept tail with the editor untouched; abort and error leaving the session unchanged; `details` intact; fallback distinct from apply; non-TUI modes inert. A limitation found in Spec 01 is a stop-and-replan gate, not permission to soften the behavior quietly.

## Validation
Fake-clock and adapter tests for every transition, threshold edge, cooldown, stale approval, cancel/abort path, cut-point selection, threshold-compaction policy, `details` round-trip and non-TUI guard. Then a real-TUI flow with observed before/after context, followed by `npm run check` for typing, tests and local registration.
