# Skills compact

Pi advertises every skill in the system prompt: name, routing description, and absolute
path to `SKILL.md`. That block is the largest removable slice of the fixed prompt.

Measured on 2026-11-05 in this repository (`opencode-go/beam-free`, `--tools read`), comparing
a normal run with `--no-skills`:

| | prompt tokens |
| --- | --- |
| without skills | 3,436 |
| with skills (46 entries, 20,106 chars) | 8,223 |
| **block cost** | **4,787** |

`extensions/skills-compact.ts` rewrites that block every time Pi builds the system prompt:

- each entry collapses to one line — `<skill name="…" location="…">description</skill>` — keeping
  the standard's fields while dropping the indentation and repeated tags (~76 chars per skill);
- a description longer than 200 characters keeps its first sentence plus the sentence that says
  when to use the skill (matched on "Use when", "Trigger", "When the user", …), then is clipped at
  a word boundary without cutting an XML entity.

Names, locations and the surrounding instructions are untouched, so the model still reads the exact
`SKILL.md` path and `/skill:name` keeps working. The same run with the trim enabled measured
**6,335 tokens: 1,888 saved (39%)**.

## Controls

| Setting | Default | Effect |
| --- | --- | --- |
| `PI_SKILLS_COMPACT` | on | `0`/`false`/`off` disables the rewrite entirely |
| `PI_SKILLS_COMPACT_LIMIT` | `200` | description cap in characters (minimum 80) |
| `/skills-compact` | — | reports entries and the characters saved for the current prompt |

## What was deliberately not done

- **Location lines are kept.** The prompt tells the model to use absolute paths, and a wrong path
  costs a failed tool call. Dropping the `<location>` and deriving it from the skill base directory
  would save roughly another 520 tokens.
- **No Jev routing.** Asking the decisions server which skills matter per turn would cut deeper,
  but it adds a per-turn call and a failure mode; it stays a separate decision (see the work queue).
- **No skill is removed.** `disable-model-invocation` would hide a skill from the prompt, but then
  the model cannot discover it at all. Trimming descriptions keeps every skill selectable.

The rewrite runs in `before_agent_start`, so it composes with the other prompt extensions: later
handlers that call `ctx.getSystemPrompt()` see the compacted prompt.
