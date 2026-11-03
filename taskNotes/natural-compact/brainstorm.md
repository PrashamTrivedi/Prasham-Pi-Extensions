# Natural compact — brainstorm

## Raw idea
The running model and decision-server decide whether there is a natural boundary, or context is at 50% or 60%, and whether the current request is ongoing work or new work. For new work, run a cheap handoff agent (a Flash model on OpenCode), insert its handoff as a user message, and start fresh. For ongoing work, also start fresh using the same agent, but include more nuance and detail, possibly the transcript.

## Current understanding

### Human-stated
- Explore a Pi extension called natural compact in the Pi Extensions repository.
- Identify natural task boundaries and/or context thresholds, and distinguish new work from ongoing work.
- Create a fresh session using a cheap-model handoff, with more detailed continuity for ongoing work.

### Assumptions to validate
- The extension aims to reduce unnecessary context usage without losing important task state.

## Questions and answers — batch 1
- Trigger: boundary AND threshold; wait until the context threshold and a natural boundary.
- Control: ask before switching, showing the reason and handoff for approval or decline.
- New request: create the session and handoff, then wait rather than automatically process the request.
- Ongoing continuity: detailed working state: goal, decisions, constraints, files, changes, tests, blockers, next steps, and a link to the old session.

## Current understanding

### Human-stated
- Consider a fresh session when both a context threshold and a natural boundary are present.
- Ask before switching, with reason and handoff; the human can decline.
- On a new request, create the new session and handoff, then wait.
- For ongoing work preserve detailed working state and a link to the previous session.

### Assumptions to validate
- Precise two-level threshold behavior, feasibility of restoring unsent text to the editor, and failure cases remain open.

## Questions and answers — batch 2
- Ongoing boundary: a safe pause or coherent milestone, even if the overall task remains unfinished; do not interrupt an active tool run.
- Pending request: put the exact request into the new session's editor for the human to submit, if Pi supports it.
- Threshold: two levels, 50% as an early candidate and 60% as a stronger prompt; specific behavior remains to be defined.
- Decision: the running model proposes a possible boundary; decision-server checks or classifies it.

## Current understanding

### Human-stated
- Use threshold plus natural boundary, including safe pauses or milestones within unfinished work.
- The running model proposes boundaries and decision-server checks them.
- Use 50% and 60% levels, with different behavior still to be defined.
- Show reason and handoff for human approval; start a fresh session only after approval.
- Keep detailed ongoing-work state and a link to the old session; preserve a pending new request as editable text if supported, and wait for submission.

### Assumptions to validate
- Whether the model's boundary proposal should be automatic and how the fallback compaction is authorized remain open.

## Questions and answers — batch 3
- Two levels: at 50% detect and display an unobtrusive suggestion; at 60% actively ask at the next verified boundary.
- After a decline: wait for another verified boundary and a configurable cooldown before asking again.
- If the exact pending request cannot be restored into the editor, preserve it verbatim as pending work in the handoff and wait for the human to say continue.
- If decision-server or the handoff agent fails, offer Pi's normal compaction as an alternative instead of switching.

## Current understanding

### Human-stated
- Natural compact looks for safe pauses and milestones once context reaches the early 50% level. The running model proposes a boundary and decision-server checks it.
- At 50% show a quiet suggestion; at 60% actively ask at the next verified boundary. On decline, wait for a new verified boundary and a configurable cooldown.
- Show a reason and generated handoff before switching; only switch with approval. Fresh sessions wait for human input.
- Preserve a pending request in the editor when possible, otherwise verbatim in the handoff. Ongoing work gets detailed working state and a link to the old session.
- Offer normal Pi compaction if decision-server or the handoff agent fails.

### Assumptions to validate
- Exact eligibility timing and operating modes, handoff agent privacy/access, and success criteria remain open.

## Questions and answers — batch 4
- At 50% the unobtrusive suggestion can be chosen to review the handoff and approve a switch immediately.
- For genuinely new work, hand off only relevant decisions, constraints, project context, pending request, and the old-session link; omit unrelated detail.
- Always ask before invoking normal Pi compaction as a fallback.
- The running model automatically signals a potential boundary; decision-server checks it.

## Current understanding

### Human-stated
- At 50% context, the running model automatically signals possible safe boundaries and decision-server checks them; display verified opportunities unobtrusively, with an on-demand handoff review and switch.
- At 60%, actively ask at the next verified boundary. Declining waits for a new verified boundary and a configurable cooldown.
- Before any fresh session, show the reason and handoff and obtain human approval. Do not interrupt active tool execution. Fresh sessions wait for human input.
- For new work, carry over only relevant context. For ongoing work, preserve detailed working state and a link to the previous session.
- Keep pending requests editable when possible, otherwise preserve verbatim in the handoff, awaiting human continuation.
- If the decision-server or handoff agent fails, offer normal Pi compaction, but always ask first.

### Assumptions to validate
- Eligibility timing and operating modes, handoff agent access and privacy, and success criteria remain open.

## Questions — batch 5 (cancelled; unanswered)
- What conversation, files, or tools may the handoff agent access?
- Should success prioritize both continuity and measured usage, continuity first, or usage first?
- Should the extension operate only in interactive sessions, support all session types, or be configurable per project?

The human clarified the cancellation was accidental and answered the same questions:
- Handoff agent access: active conversation and relevant task state; may inspect referenced files if needed.
- Success: continuity and usage, tracking handoff/switch overhead and context before/after, plus whether work continues without important losses.
- Scope: all session types, including non-interactive and automated sessions; approval behavior remains to be defined.

## Current understanding

### Human-stated
- The cheap handoff agent can access the active conversation and relevant state and inspect referenced files when needed.
- Evaluate continuity and usage, including handoff overhead and context before/after.
- Support all session types, including non-interactive and automated sessions, while maintaining human approval before switching and fallback compaction.

### Open questions
- Approval integration for automated sessions, privacy controls, and exact metrics.

## Questions and answers — batch 6
- Unattended runs: pause and expose an approval request to the calling system; wait for a response. Human approval remains required.
- Handoff agent: read-only; inspect conversation and relevant files without modifying files or running mutating commands.
- Metrics: show concise information in the session and record measurements locally for comparison.
- Original session retention: use Pi's normal retention and link the original session in the handoff.

## Current understanding

### Human-stated
- Support interactive and automated sessions; automated sessions pause and expose an approval request to the calling system, awaiting a response.
- Handoff generation is read-only and may use the active conversation, relevant state, and referenced files.
- Show usage and continuity measurements in the session and record them in a local log.
- Preserve access to the old session under normal Pi retention and link to it from the handoff.

### Assumptions to validate
- Approval transport depends on session type and Pi capabilities.

## Questions and answers — batch 7
- If approval cannot be handled or never arrives: timeout and stop the run, reporting approval unavailable; do not switch automatically.
- Local measurement log: include handoff text as well as measurement information.
- Assessing handoff continuity with explicit checks or feedback: out of scope.
- New versus ongoing classification: the running model proposes and decision-server checks, matching boundary detection.

## Current understanding

### Human-stated
- Automated runs pause for approval; if unavailable or unanswered, stop after a configurable timeout and report the reason.
- Include handoff text in the local measurement log. Original sessions use normal Pi retention.
- Track usage and context measurements, but explicit continuity checks and feedback are out of scope.
- The running model proposes both boundary and new-versus-ongoing classification; decision-server checks both.

## Questions and answers — batch 8
- If the running model and decision-server disagree or the server is uncertain: the server decides.
- Handoff logs: restricted access, configurable retention with a 30-day retention period.
- Handoff model: configurable, default to an available OpenCode Go Flash model.
- Context thresholds: fixed at 50% and 60% initially.

## Current understanding

### Human-stated
- The decision-server makes the final boundary and work-type classification when judgments disagree or it is uncertain.
- Record handoffs in a restricted-access local log, with configurable retention defaulting to 30 days.
- Use a configurable handoff model, defaulting to an available OpenCode Go Flash model.
- The initial thresholds are fixed at 50% and 60%.

## Questions and answers — batch 9
- Handoff review: approve, edit, or decline before switching.
- If the original session cannot be safely resumed or linked, do not switch.
- The human requested consolidation into requirements.

## Current understanding

### Human-stated
- The human can approve, edit, or decline the proposed handoff before switching.
- Do not switch when the original session cannot be safely resumed or linked.
- If the decision-server fails to return a decision, use the earlier failure behavior: offer ordinary Pi compaction, requiring approval.

### Open questions
- Exact implementation feasibility of switching, approval across session modes, restoring editor text, and confirming recoverability belongs to subsequent planning.
