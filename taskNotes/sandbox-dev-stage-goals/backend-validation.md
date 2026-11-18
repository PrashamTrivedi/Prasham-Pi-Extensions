# Backend validation — sandbox-dev stage goals

No HTTP API; the "backend" here is the Pi extension runtime. Every command ran from the repo root
on branch `sandbox-dev-stage-goals`.

| Command | Exit | Summary |
|---|---|---|
| `npm run typecheck` | 0 | `tsc --noEmit`, no output |
| `bun test tests/sandbox-dev` | 0 | 89 pass, 0 fail, 288 expect() calls (6 files) |
| `npm test` | 0 | 510 pass, 0 fail, 2076 expect() calls (57 files) |
| `node scripts/check-package.mjs` | 0 | package manifest valid |
| `node scripts/check-local.mjs` | 0 | local-first rule holds |

## Flows exercised

- **Gate → goal:** presenting the gate writes nothing; a typed `g` (source `interactive`) writes
  `goal.md` with the verbatim `Original Ask` and arms supervision; `g: <note>` adds
  `## Human note`; `t: …`, `r`, `extension`, and `rpc` sources leave the gate open; a model source
  write cannot arm the anchor.
- **Work → complete:** `dev_stage` returns `NOT READY` with `work_finished` while Jev says the work
  is unfinished, and escalates after three consecutive failures; on a pass it rewrites `goal.md`
  with `## Files present` for the detected mode, announces the switch, resets the turn budget
  (next settle is `turn 1/8`), and persists a `sandbox-dev-stage` entry.
- **Complete validator:** real temp git repos with a conventional one-line commit, a bare origin,
  `currentCommitHash..HEAD` containing a test file, and the mode's artifacts pass; a missing
  artifact, a review without a terminal line, a commit with a body, an unpushed branch, an empty
  test diff, and an unreachable decision server each fail with the named miss. `semantics` and
  `stage` cannot be waived; a reasoned waiver clears `pushed`.
- **Outcome:** the declared `evidence` is judged together with the transcript turns;
  `dev_outcome_met` refuses in the work stage (`stage` miss), records `met: false`
  with the misses when it fails, and records `met: true` with `waived` + `not_run` when it passes.
  The criterion map (8 `noul` scores) is written to `goal.md` and the outcome entry.
- **Fixture dry run:** `tests/fixtures/taskNotes/88-skills-commands-import` (plan + requirements +
  walkthrough + review passes + backend validation) copied into a temp repo passes
  `validateComplete`; removing the review terminal line fails it.
- **Resume:** the last non-escalated stage entry regenerates `goal.md` from the plan (stale file
  ignored); an escalated stage entry and a `met` outcome entry are not resurrected.
