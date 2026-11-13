# Duck rework — requirements (DRAFT)

**Not validated.** Written on 2026-11-05 from `brainstorm.md` before the first human batch; it
records the requirements shape so the answers have somewhere to land. Do not implement from this
file until the open questions are answered.

## Goal

Turn Duck into a second opinion the human actually uses: a review of the work in progress that
surfaces risks, missing evidence and the decisions only the human can make — with the existing
`AskUserQuestion` path kept for those decisions.

## Who and why

For the same person who plans and approves work here. Today's Duck reviews one assistant message
with no evidence and asks generic questions; it neither changes a decision nor saves the human
from a bad plan.

## Requirements (proposed — confirm each)

1. **Input is evidence, not prose.** The review sees the plan, the working diff (bounded), the
   files touched, and the last N tool outcomes. Every input is byte-capped and redacted like other
   prompt extensions.
2. **Default output is a verdict.** One short review with: what is assumed, what is missing, what
   is risky, and the one decision the human should make. Questions are optional and capped as they
   are today.
3. **Questions stay first-class.** A decision the human owns becomes a structured question through
   `AskUserQuestion`; answers return in the tool result, as now.
4. **Human-initiated and agent-initiated both work.** A command/shortcut runs a review on demand;
   the tool stays available for the agent.
5. **Model is configurable.** The review model defaults to a configured cheap model and can be
   pinned per run; the result names the model and its cost so the human can judge it.
6. **Failure is visible, never silent.** No model, a parse failure or a timeout produces an error
   result naming the cause; a partial review is labelled partial.
7. **No side effects.** The review never edits files, never sends the editor's content, and never
   writes to the session on its own.
8. **Cheap by construction.** A review costs less than the main turn that produced the plan; when
   the configured model is unavailable, say so instead of silently using the expensive one.

## Non-goals (unless the brainstorm overturns them)

- Automatically gating every plan on a Duck review.
- Multi-agent debate or a persistent review history.
- Replacing semantic lint, sandbox gates, or the decision server.
- A web or non-TUI surface.

## Measurable success criteria

- On a 10-plan sample, the review names at least one concrete risk or missing test that the human
  rates as "worth acting on" in ≥6 cases (human rating, not model self-report).
- ≥70% of reviews need no follow-up question to be understood.
- Median review cost ≤25% of the main turn's cost, measured from provider usage.
- Zero reviews silently fall back to the active model without saying so.
- No review changes the session, files, or editor contents.

## Open questions

- Default output shape and length (a 5-line verdict vs a longer review).
- Whether answers should be summarised back into the chat automatically.
- Whether the review is one shot or a conversation.
- The exact context set and its caps, and whether the diff is included on dirty trees only.
- Default cheap model and the escalation rule.
- Which surface ships first: command, tool, or both.
