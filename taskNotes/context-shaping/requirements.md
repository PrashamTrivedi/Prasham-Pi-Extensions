# Context shaping — requirements

## Goal

Keep the working context small and relevant without losing the thread: old tool output, pasted
HTML and screenshots, and unused tools stop being re-sent every turn, and the model still has what
it needs to continue.

## Who and why

For long sessions and agent-heavy work: one large tool result or pasted page can sit in context for
the rest of the session and be re-sent (and re-billed) every turn. Today the only lever is
compaction, which rewrites everything at once.

## Requirements

1. **Tool-result trimming.** Old tool results are replaced by a bounded stub — a one-line summary
   plus the byte count and a way to re-read — once they are outside the last N turns and over a size
   threshold. The current turn and the previous turn are never trimmed. The stub is deterministic
   (`read` → `path, lines 1-200 (12 KB)`) so the model can ask for it again.
2. **Attachment shaping.** Images and pasted HTML/JSON are dropped from re-sent history before
   trimming text: an image becomes `[image dropped after 2 turns]`, HTML becomes its title/h1 plus
   the URL. The most recent attachment per turn is kept.
3. **Tool exposure control.** Tools unused for K turns are hidden from the request (not removed
   from the session) and come back when the model asks for them or a matching intent appears.
   Exposure changes are logged and bounded per turn.
4. **Never lose the thread.** The final assistant message, the last user prompt, any text the model
   explicitly cited, and the plan/handoff are never trimmed. Trimming is idempotent and re-applies
   after compaction or reload.
5. **Why it happened.** Every trim is recorded in a local, inspectable log: what was replaced, its
   size, and the rule that matched. `/context-shaping` reports the current saving and the rules in
   effect.
6. **Opt-out and per-rule switches.** The feature can be disabled globally, per rule (results,
   attachments, exposure), and per session. Defaults are conservative: trim only beyond the last
   two turns and above 8 KB per result.
7. **Compatibility.** Works with the existing prompt-building extensions (`before_provider_request`
   or the Pi context-transform hook), with Fabric workers, and with natural-compact's handoff.
   It must not fight Pi's own compaction: when a compaction happens, the shaping state is rebuilt
   from the new projection.

## Non-goals

- Summarising tool output with a model call in v1 (deterministic stubs only).
- Dropping user messages or assistant text.
- Changing what is stored in the session file; shaping affects only what is sent.
- Automatic model switching (that is the routing feature).

## Measurable success criteria

- On a 10-session sample with large tool output, median prompt tokens **drop ≥25%** at the same
  task completion rate, measured from provider usage.
- Zero re-asks caused by a trim in the sample: a trimmed result is never needed without the model
  being able to re-read it.
- No turn loses its current or previous turn's content; a diff of the sent context shows only the
  intended replacements.
- Tool exposure changes at most twice per turn and never hides a tool the model used in the last two
  turns.
- `/context-shaping` reports a saving consistent with the provider usage within 5%.
- Disabling the feature restores byte-identical context for the next turn.

## Open questions

- Which hook actually rewrites the sent context in this Pi version (`before_provider_request` event
  vs. a context-transform extension API), and whether the transcript view stays truthful.
- The default thresholds (turns kept, bytes per result) — needs a measurement pass on real sessions.
- Whether tool exposure should be driven by the tool set or by intent matching, and how to avoid
  hiding a tool the model would have used.
- Whether stubs should include a content hash so a re-read is verifiable.
- How this composes with natural-compact: shaping runs first, and compaction should measure the
  shaped context or the raw one?
