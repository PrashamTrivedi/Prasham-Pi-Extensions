# Natural compact — requirements

## Goal
Reduce unnecessary conversation context while preserving useful continuity by proposing fresh Pi sessions at natural work boundaries.

## Who and why
For Pi users working across long conversations and tasks, including interactive and automated sessions. A fresh session should retain relevant decisions and working state without routinely carrying unrelated history forward.

## Requirements
- Use fixed initial context thresholds of 50% and 60%. Consider switching only when the threshold and a natural boundary are both present. A safe pause or coherent milestone can be a boundary even if the larger task is unfinished; do not interrupt active tool execution.
- The running model automatically proposes potential boundaries and classifies work as new or ongoing. Use decision-server → Jev → ask the human when judgment cannot be made confidently. The human's boundary decision is separate from the required handoff/switch approval. The exact integration and failure/uncertainty contract require a feasibility spike.
- At 50%, show verified opportunities unobtrusively and allow the user to initiate handoff review. At 60%, actively ask at the next verified boundary.
- After a declined switch, wait for another verified boundary and a configurable cooldown before asking again.
- Generate a handoff with a cheap model, configured once, defaulting to an available OpenCode Go Flash model if available. The handoff agent may read the active conversation, relevant state, and referenced files, but must not modify files or execute mutating commands.
- For new work, preserve only relevant decisions, constraints, project context, the pending request, and a link to the old session. For ongoing work, preserve detailed working state including the goal, decisions, constraints, relevant files, changes, tests, blockers, next steps, and a link to the old session.
- Present the reason and handoff for human review. Allow the human to approve, edit, or decline it; start a fresh session only after approval.
- When a pending request prompted the switch, preserve its exact text in the new session's editor if possible. Otherwise retain it verbatim as pending work in the handoff. Wait for the human to submit or continue rather than automatically executing it.
- Do not switch if the original session cannot be safely resumed or linked. Otherwise retain it under Pi's normal session retention.
- Initial scope is interactive Pi (TUI) first. Automated and RPC support remain future work: a later version must pause and expose an approval request to the calling system, and stop after a configurable timeout if approval cannot be handled or does not arrive; do not switch automatically.
- If decision-server or handoff generation fails, offer ordinary Pi compaction as an alternative. Always obtain approval before invoking this fallback.
- Show usage and context measurements in the session and record them locally for comparison, including handoff/switch overhead and context before and after. Include the handoff text in the local log, restrict access, and support configurable retention defaulting to 30 days.

## Non-goals
- Automatic switching without human approval.
- Interrupting an active tool run to switch sessions.
- Automatic continuity scoring or human-feedback collection for handoff quality.
- Automatically running fallback Pi compaction without approval.

## Open questions
- Confirm feasibility of automatic boundary prompts and command-only session switching, preserving pending editor text, and determining whether an original session can be safely resumed and linked. Automated/RPC approval transport is deferred beyond the interactive first version.
- Define the decision-server/Jev boundary-classification contract, including uncertainty, failure, and human escalation.
- Define exact metrics and the configurable cooldown and approval-timeout defaults during planning.
