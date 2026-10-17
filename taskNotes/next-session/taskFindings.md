# Next session — plan

**Status: nothing to do now.** This is captured only so the next session can pick it up.

## Original Ask

> Remove that duck file. I think we need to rework for duck. so here is the next plan, save it somewhere.
>
> 1: Duck will be reworked a lot. I don't like current duck.
>
> 2: Minor changes in Fabric as well.
>
> 3: We need to use brainstorm skill from claude.
>
> Nothing to do now, Just remember these, so that we can pick up in next session.

## 1. Duck — major rework

The current duck is disliked. Everything it does today is a **starting point, not the
target**: the docked questions panel, `/duck` / `/duck answer` / `/duck close`, the
JSON-questions prompt and parser, the raw-text fallback, and the shared
AskUserQuestion-style questionnaire.

Next session starts with requirements and design — not code. Do not treat any existing
duck behaviour as a constraint worth preserving just because it exists.

Superseded context: the previous `taskNotes/duck-answer-pane/` plan was **removed** at the
human's request; its three decisions (questionnaire as a shared tool, duck auto-opening,
questions + answers both written to the editor) are not binding. Carry forward only what
the fresh brainstorm re-derives.

## 2. Fabric — minor changes

Unspecified at capture time. Scope deliberately left open.

Context so it is not confused with recent work: Fabric was already changed this cycle —
unrecorded models are now unrestricted, and `/reload` re-applies an edited hierarchy to
the existing root (committed in `34208d0`). The "minor changes" here are a **separate,
not-yet-specified** set.

## 3. Use Claude's brainstorm skill

The process for items 1 and 2 next session is the **`brainstorming` skill from the
superpowers plugin**, not the sandbox-dev flow and not an immediate implementation pass.

- Skill: `~/.claude/plugins/cache/anthropic-plugin-directory/superpowers/<version>/skills/brainstorming/SKILL.md`
  (the `<version>` segment is e.g. `6.4.2-8ca22dba9a94` and changes on plugin update —
  glob for it). Frontmatter: *"You MUST use this before any creative work … Explores user
  intent, requirements and design before implementation."*
- Claude command: `~/.claude/commands/brainstorm.md` (`/brainstorm`), which takes raw
  ideas and finalizes them into specs.
- The skill ships `scripts/`, `spec-document-reviewer-prompt.md`, and
  `visual-companion.md` — read them, not just `SKILL.md`.
- **Pi has no equivalent skill registered.** Read the skill file and follow it as the
  process; do not assume it is auto-loaded here.

Its shape, for a fast start: discover intent → write back the understanding for correction
→ carry it into a design artifact → get approval before implementation.

## Housekeeping at capture

- Removed: `taskNotes/duck-answer-pane/` (superseded).
- Kept: `docs/layout-compare.html` — the playable A-vs-B cockpit/duck layout explainer
  built by a `deepseek-v4-pro` subagent (also `/tmp/pi-cockpit-a-vs-b.html`).
- Last commit: `6b67475`. `npm run check` green — 163 tests pass, 0 fail, 9 extensions,
  local-first rule validated.
