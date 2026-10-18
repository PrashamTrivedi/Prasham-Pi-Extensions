---
name: brainstorm
description: Clarify and ideate a feature's requirements with the human before any implementation. Use when the user wants to brainstorm, ideate, or pin down what to build ("let's brainstorm", "help me figure out the requirements", "what should this do?").
---

# Brainstorm — clarify requirements before building

Turn a raw idea into a clear, human-verified requirements doc through a short,
structured Q&A loop. The human's answers are the source of truth; you are only
asking the right questions and writing them down. No code, no plan, no
implementation yet.

## Loop

1. **Open a topic.** Take the human's one-line idea. Derive a task token
   (kebab-case, at most 3 words) and create `taskNotes/<topic>/brainstorm.md`,
   seeded with the raw idea. If the file already exists, resume it instead of
   overwriting.

2. **Ask in batches of up to 4.** Call the `AskUserQuestion` tool with one batch
   of 1–4 questions at a time (4 is the tool's maximum — use a full batch when
   four things are genuinely open). Every question gets 2–4 concrete options and
   `allowOther: true` so the human can type their own answer. Aim each batch at
   what is still unclear:
   - who it is for and what problem it solves,
   - what "done" looks like (success criteria),
   - scope boundaries and explicit non-goals,
   - constraints (time, platform, existing code, budget),
   - the smallest useful first version.

   One batch at a time. Never dump every question at once, and never re-ask what
   the transcript or the brainstorm doc already answers.

3. **Write back understanding.** After every batch, append to
   `taskNotes/<topic>/brainstorm.md`:
   - the questions and the human's answers, and
   - a `## Current understanding` block — a few bullets restating what the
     feature now is, keeping "what the human said" separate from "my assumptions".

   Echo the understanding in the chat and invite correction. Incorporate any
   correction before asking more.

4. **Converge.** Stop when the human says it is clear/done, or when you have no
   open questions left. If it stalls, list the open questions explicitly instead
   of guessing.

5. **Write the requirements doc.** Once converged, write
   `taskNotes/<topic>/requirements.md` — the clarified requirements only, with
   no technical details:

   ```markdown
   # <topic> — requirements

   ## Goal
   One or two sentences on the intended outcome.

   ## Who and why
   Who it is for and the problem it solves.

   ## Requirements
   - Concrete, human-verified requirements.

   ## Non-goals
   - Explicitly out of scope.

   ## Open questions
   - Anything still unresolved, or "None".
   ```

6. **Hand off.** Requirements are the input to the existing sandbox-dev flow
   (`plan → approval → implement`). Stop here — do not plan or implement in this
   skill.
