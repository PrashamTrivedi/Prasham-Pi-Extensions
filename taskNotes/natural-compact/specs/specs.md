# Natural compact — implementation breakdown

Read the [main plan](../taskFindings.md) and [requirements](../requirements.md) first. These are sequential gates, not separate approvals to implement.

**Destination: continuous chat.** v1 reduces context by rewriting the live window in place (`compact()` + a custom `session_before_compact` summary) rather than starting a new session. The fresh-session destination is deferred and therefore has no spec here; if it is revived it needs its own feasibility gate, because it alone carries the editor-restoration and persist-without-turn unknowns.

1. [Feasibility: the compaction contract and the verdict](01-feasibility/taskFindings.md) — prove in-place apply, the summary's structured `details`, repeat compaction, recoverability, and a typed boundary decision. Stop the path if any of these cannot be demonstrated.
2. [Runtime and user experience](02-runtime/taskFindings.md) — eligibility, judgment, review with a visible cut point, and a safe in-place apply, built only on what Gate 1 proved.
3. [Privacy, measurement and validation](03-validation/taskFindings.md) — restricted logs, honest metrics, documentation and end-to-end verification. Privacy applies from the first prototype that touches real transcripts.

Rules that hold across all three: interactive TUI only in v1; no apply without its own approval; boundary confirmation is not apply approval; unknown usage never triggers a threshold decision; nothing is deleted or re-derived silently.
