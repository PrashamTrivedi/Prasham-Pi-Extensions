# Natural compact — requirements

## Goal
Reduce unnecessary conversation context at natural work boundaries **without leaving the session**: a reviewed handoff summary replaces the stale span, the older turns stay in the file, and the chat continues from the handoff. The user should keep working in the same conversation, with their unsent draft still in the editor.

## Who and why
For Pi users working across long conversations and tasks, including automated sessions. A continued session should retain relevant decisions and working state without routinely carrying unrelated history forward.

## Requirements
- Use fixed initial context thresholds of 50% and 60%. Reduce only when the threshold and a natural boundary are both present. A safe pause or coherent milestone can be a boundary even if the larger task is unfinished; never interrupt active tool execution.
- The running model automatically proposes potential boundaries and classifies work as new or ongoing. Use decision-server → Jev → ask the human when judgment cannot be made confidently. The human's boundary decision is separate from the required handoff approval. The exact integration and failure/uncertainty contract require a feasibility spike.
- At 50%, show verified opportunities unobtrusively and allow the user to initiate handoff review. At 60%, actively ask at the next verified boundary.
- After a decline, wait for another verified boundary and a configurable cooldown before asking again.
- Generate a handoff with a cheap model, configured once, defaulting to an available OpenCode Go Flash model if available. The handoff agent may read the active conversation, relevant state, and referenced files, but must not modify files or execute mutating commands.
- For new work, preserve only relevant decisions, constraints, project context, and the pending direction. For ongoing work, preserve detailed working state including the goal, decisions, constraints, relevant files, changes, tests, blockers and next steps. Uncertainties must survive the summary.
- Show the reason and handoff for human review. Allow the human to approve, edit, or decline it; reduce context only after approval.
- Make the cut point an explicit, visible choice — how much recent conversation is kept alongside the handoff — with a stated default.
- Never move, rewrite or submit the editor's unsent text. It is not part of the handoff and cannot be a condition of the reduction.
- Do not delete stored history. Omitted entries remain in the session file, and the human must be able to inspect what was summarised to the degree the feasibility spike establishes.
- If decision-server or handoff generation fails, offer ordinary Pi compaction as an alternative — with its own approval, and visibly distinct from a handoff.
- Show usage and context measurements in the session and record them locally for comparison, including handoff overhead and context before and after. Include the handoff text in the local log, restrict access, and support configurable retention defaulting to 30 days.
- Initial scope is interactive Pi (TUI) first. Automated and RPC support remain future work: a later version must pause and expose an approval request to the calling system, and stop after a configurable timeout if approval cannot be handled or does not arrive; do not reduce context automatically.

## Non-goals
- Reducing context without human approval.
- Starting a fresh session or transferring the conversation to a new one (deferred; see the plan's destination decision).
- Interrupting an active tool run to reduce context.
- Automatic continuity scoring or human-feedback collection for handoff quality.
- Automatically running fallback Pi compaction without approval.

## Open questions
- Default cut point, and whether "keep none" is offered.
- What the extension does when Pi's own threshold compaction fires rather than the loop's.
- Precisely what "recoverable" means after a handoff: what the human can inspect or return to.
- The decision-server/Jev boundary-classification contract, including uncertainty, failure and human escalation.
- Configurable cooldown and approval-timeout defaults.
