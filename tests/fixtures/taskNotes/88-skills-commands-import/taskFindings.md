# Purpose

Import skills and slash commands from GitHub, a URL or an upload into versioned storage, keep them
up to date automatically with a visible history and one-click rollback, and use commands from the
chat box. Issues #88 and #89. Requirements: `requirements.md` (agreed 2026-11-17).

## Original Ask

Issue #88 ("Import skills from GitHub, a URL or an upload") and #89 ("Slash commands"), with the
owner's decisions of 2026-11-17: R2 bundles as the store so resource files are kept; private repos
if the GitHub connection can reach them; no owner accept, upstream changes apply from the next turn,
with a visible log and one-click rollback; scheduled check plus a manual "Update now" (turn-start
check assumed, see open items); skills and commands together; commands expand in the composer into
plain message text, global with a per-bot hide; unsupported command syntax imports as literal text
with a warning; skills stay off until enabled per bot. Full text in `requirements.md`.

## Complexity and the reason behind it

**4 / 5.** It is wide rather than deep: a pure importer, two fetchers, new D1 tables and R2 layout,
a change to how the library resolves skills, a new scheduled job, new routes, and two frontend
surfaces. Three things raise it above a routine feature: the library is write-once by design and
auto-update has to coexist with that; "applies next turn" depends on a live bot re-installing its
skills extension; and the live proof needs a deployed beta, a real repo and a real upstream change.
Nothing needs new platform bindings (the `SKILLS` bucket already exists).

## What the code already gives us (verified 2026-11-17)

- `backend/src/v3/skills/sources.ts` already builds `r2(env.SKILLS, { prefix })` sources and the pi
  harness consumes them (`agents/harness/pi` `skills(sources)`). Nothing in the manifest feeds it.
- The SDK `r2` source: skill folders are **direct children** of the prefix; the skill's name is the
  **frontmatter `name`**, not the folder; it accepts a per-source `skills` allowlist, an `id`, and
  `refreshIntervalMs` (default 60 s); resources are every other object under the folder; it parses
  `SKILL.md` at runtime with `parseSkillMarkdown`, which returns `null` when name or description is
  missing. A skill whose frontmatter does not parse is skipped, but I have not proven that a hard
  YAML error cannot throw out of the index, which would drop the whole source. So the importer must
  validate with this same parser and refuse anything it cannot parse.
- `pi-durable` has no skill concept. `skills(sources)` lists sources **once when the extension is
  built** (catalogue goes into the system prompt) and the activation tools read bodies live. A change
  therefore reaches a running bot only through `Bot.refreshIntegrations()` (`bot/durable.ts:595`),
  which reinstalls the extension and "lands on the next turn". That is the mechanism for "applies
  from the next turn".
- The library (`integrations` table, `integrations/store.ts`) is **write-once** (only `state`
  changes) and a skill row carries its whole body as JSON capped at 64,000 characters. Imported
  skills must not break that rule, so an imported row will be a stable pointer, never content.
- GitHub: `github/client.ts` talks only to `api.github.com`, caps a body at 1 MB, and parses JSON, so
  it cannot download an archive as is. `github/app-auth.ts` and `resolve.ts` mint installation tokens
  for repos the owner's App is installed on.
- There is **no Worker `scheduled` handler** and no platform cron (`worker.ts` exports only `fetch`).
  Bot-level schedules exist inside Bot Durable Objects, not for platform jobs.
- Composer (`frontend/src/components/chat/Composer.tsx`) sends plain text; no `command` kind exists
  (`INTEGRATION_KINDS = ['mcp','skill']`).
- The working tree on `feat/unbounded-tool-output` is dirty with unrelated work. Build this from a
  clean branch off `main` (main is gated: PR only).

## Architectural changes required

**Concepts.** A **source** is one place items come from (GitHub repo+ref+folder, URL, or upload). A
source has **versions**; each version is an immutable folder of the ticked items in R2. A source has a
**current** version and a **previous** one. An **item** is one skill or command in a source.

**Storage.**
- R2 (`SKILLS` bucket): `imports/<sourceId>/<version>/skills/<dir>/SKILL.md` plus that skill's other
  files, and `imports/<sourceId>/<version>/commands/<name>.md`. `<version>` is the commit sha for
  GitHub and a content hash for URL/upload. Commands live in a separate folder so the SDK's skill
  scan never reads them. Staged scans live under `staging/<scanId>/` and are removed by the
  scheduled job after a day. Versions older than the last five are pruned.
- D1 (additive, in `schema/v3.sql` and `testing/schema.ts`): `import_sources`, `import_items`,
  `import_history` (columns in S3).

**Library wiring (keeps write-once).**
- A library `skill` row may be an *imported pointer*: `{ origin: 'import', sourceId, itemId }`. The
  row never changes. Its content is resolved at read time from the source's current version. It is
  keyed on the `import_items` id (the stored folder), not the name, so an upstream rename does not
  orphan it.
- **Commands are not library rows and not manifest state.** `INTEGRATION_KINDS` stays
  `['mcp','skill']`; the stored manifest gains no fields. `/api/commands` is served from
  `import_items` + R2, and a per-bot hide lives in a small `bot_hidden_commands(owner, bot_id, name)`
  table. The runtime never reads commands, so nothing in the harness changes for them.
- A bot's `skills` ids stay as they are. Resolution turns imported-pointer ids into one SDK `r2`
  source **per import source**, with `prefix` = the source's current version, `skills` = the names
  this bot enabled, and `id` = `import:<sourceId>@<version>` (the version is in the id, so a flipped
  prefix can never be deduped away by the registry), with the same value as the fingerprint.
  Imported skills resolve into a separate list beside `ResolvedSkill` (which requires `body`);
  library JSON skills still go through `fromManifest`. First source wins on duplicate names
  (existing rule; home still beats library), and a commit refuses a name that already exists in the
  library or another source, so nothing is shadowed silently.
- A pointer that no longer resolves (item removed upstream, source deleted) is **skipped with a
  stated reason**, never fatal, as today.

**Sync engine.**
- `syncSource(sourceId, trigger)` where trigger is `auto | manual | rollback`: find the upstream
  version (GitHub: resolve ref to a commit sha with a conditional request; URL: fetch and hash;
  upload: no upstream), stop if unchanged; otherwise download, scan, write all ticked items to a new
  R2 version, then flip `current_version` in D1 in one batch (the flip is last, so a failed write
  leaves the old version live), record history with a per-item change summary, and call
  `refreshIntegrations()` on every bot that enabled an item from that source.
- Triggers: a new Worker `scheduled` handler (cron every 15 minutes, `triggers.crons` in
  `wrangler.jsonc`), a throttled check when a bot turn starts (background, so the change lands on
  the turn after), and the manual route. **Uploads are excluded from every automatic trigger** (owner,
  2026-11-17): an upload has no upstream, so it is written once at commit and never checked,
  rehashed or replaced by the schedule or the turn-start check. "Update now" is refused for an
  upload with that reason and the UI disables it; remove and import again to change it.
- **Rollback pauses auto-update for that source** (`held_at` set); otherwise the next check would
  reapply the upstream version and undo the rollback. "Update now" clears the hold. This is my
  addition, needed for the requirement "one action rolls an item back" to mean anything.
- **A rollback reverts the whole update** (the source's previous version) and the UI names every item
  it changes. Per-item rollback is a follow-up, not built here (owner FYI, default accepted).
- **The flip is a compare-and-set** (`UPDATE … WHERE current_version = ?`) and version writes are
  keyed by sha, so a raced or repeated sync cannot double-apply. Pruning skips any version an item
  still points at.
- **New upstream items are not auto-imported.** A source's tick selection is stored; a later scan
  shows "N new available". Only selected items follow upstream. Removed items are marked missing,
  not deleted.

**Security posture** (no approval gate, by the owner's decision): every change is logged with old and
new version; the import screen and first enable carry the "this text becomes the bot's instructions"
notice; bots cannot create, update, or roll back sources (owner routes only, no bot tool);
`propose_integration` is unchanged and cannot produce a pointer row.

## Backend changes required

New code under `backend/src/v3/importer/` (pure core) and `backend/src/v3/imports/` (I/O), plus
edits to `integrations/*`, `skills/sources.ts`, `manifest.ts`, `bot/durable.ts`, `routes/*`,
`worker.ts`, `wrangler.jsonc`, `schema/v3.sql`, `testing/schema.ts`. Details per spec:

- **S1 importer core:** archive readers (tar.gz via `DecompressionStream` and a small tar reader; zip
  via `fflate`, the one new dependency, with entry-count and expanded-size caps), file scanner for
  `**/SKILL.md` (direct folder per skill) and `**/commands/*.md`, validation with the SDK's own
  `parseSkillMarkdown`, command frontmatter (`description`, `argument-hint`), flags (`hasScripts`,
  resource list, literal-syntax warnings), per-item hashes and a diff.
- **S2 fetchers:** GitHub (ref to sha, tarball download through a new archive function because the
  existing client cannot, caps, token handling reuses the App credential), URL fetch (https only,
  timeout, size cap, redirect limit, relies on `global_fetch_strictly_public`), upload ingestion,
  staging in R2.
- **S3 storage and history:** tables, R2 version writer, current/previous pointers, history rows,
  prune, rollback.
- **S4 library wiring:** skill spec union keyed on `itemId`, a resolved-import list beside
  `ResolvedSkill`, resolution to `r2` sources with a versioned `id`, skip reasons. No `command`
  kind, no manifest change; `refreshIntervalMs` stays high (a version prefix is immutable, so a
  short interval only buys R2 list calls).
- **S5 sync and triggers:** `syncSource`, scheduled handler, turn-start check, hold-on-rollback,
  fan-out to `refreshIntegrations()`, staging cleanup.
- **S6 routes:** `POST /api/imports/scan` (JSON or multipart), `POST /api/imports` (commit),
  `GET /api/imports`, `POST /api/imports/:id/update`, `POST /api/imports/:id/rollback`,
  `DELETE /api/imports/:id`, `GET /api/commands`, `GET /api/commands/:name`, and
  `PUT /api/bots/:id/commands/hidden` over the `bot_hidden_commands` table (no manifest write).
  Owner-scoped by the where clause like the existing library routes.

## Frontend changes required

- **S7 import UI** (Settings, Integrations): "Add skills and commands" sheet with GitHub / URL /
  Upload tabs, scan results with tick boxes, open-to-read full text, skip reasons, script and
  literal-syntax flags, duplicate-name choice, import. A **Sources** list with update status, last
  checked, history (old to new, what changed), **Update now**, **Roll back**, **Remove** (names what
  goes). The one-time trust notice at first enable. Scripts-flag badge on library and bot skill rows.
- **S8 commands:** `/` autocomplete in the composer (list with descriptions), a pure
  `expandCommand(body, args)` filling `$ARGUMENTS` and `$1..$9`, sending the expanded text as an
  ordinary message, and a per-bot hide toggle on the bot page.
- Hooks `useImports`, `useCommands`; keep the existing `useIntegrationLibrary` for skills.

## Acceptance Criteria

1. Scanning a public repo lists every skill and command found, each tickable and readable; a
   malformed `SKILL.md`, an empty file, an oversized file, and a duplicate name each appear with a
   stated reason and do not block the rest.
2. Importing two skills and one command creates a source at the repo's commit; the two skills appear
   as library rows with no body copied into D1; resource files are in R2 beside each skill.
3. Both skills are **off** on every bot until enabled for one; enabled on the dev bot, a live chat
   activates and follows them (`activate_skill`, `read_skill_resource` for a resource).
4. The command appears after `/`, expands with `$ARGUMENTS`/`$1`, and the transcript shows the
   expanded text; `!` and `@file` lines stay literal and the import screen warned about them.
5. An upstream commit changes a skill: within the schedule interval (or on Update now) a new version
   exists, history shows old and new sha and what changed, and the **next turn** uses the new text
   with no owner action. Newly added upstream items are shown as available, not imported.
6. Roll back: the next turn uses the previous version, the source shows **held**, a scheduled check
   does not reapply, and Update now does.
7. A skill folder with scripts is flagged and nothing runs.
8. Private repo: imports when the App is installed on it; otherwise a plain refusal naming what is
   missing and nothing is stored. (Conditional on open item 5.)
9. A source removed: its rows, history and R2 versions go; bots enabled on it lose the skill with a
   stated skip, no error in a thread.
10. A bot cannot create, change or roll back a source by any tool.
11. Backend `tsc` and `npm test`, `npm run test:workers` (memory guard), frontend build, `tsc` and
    `npm test` all green, one suite at a time; bundle size before and after reported.

## Validation

Commands, from the worktree root, one suite at a time machine-wide. `safe-test.sh` does its own
`cd`, so pass a directory and never `cd` first (the old form `cd backend && ../taskNotes/…` re-enters
`backend/` and fails):
- `cd backend && npm run type-check && npm test`
- `taskNotes/v3-handoff-2026-11-05/safe-test.sh /root/Code/meta-agent-system-88/backend \
  "npm run test:workers"` (exit 75 or 137: report, do not loop)
- `cd frontend && npm run build:worker && npm run type-check && npm test`
- `cd backend && npx wrangler deploy --dry-run` for bundle size.

Note: the guard measures the whole machine, so a run in the worktree still excludes any run in the
primary tree.

Backend flows (API and Workers tests, fixtures in-repo; no network in tests):
- Scan: valid, nested, malformed, duplicate name, oversize, tar bomb and zip bomb (caps), path
  traversal in an archive entry, symlink entry, non-UTF-8 file, resource beside a skill, scripts.
- Commit then enable: pointer row resolves to an `r2` source with the allowlist; disabled bot gets
  nothing; a deleted item yields a skip reason.
- Sync with a fake GitHub: unchanged (304) is a no-op; changed writes a version, flips the pointer
  last, records history, calls refresh on enabled bots only; a failure mid-write leaves the old
  version live; rollback holds; Update now clears the hold; pruning keeps five.
- Routes: owner scoping, validation errors, multipart upload cap, a second owner's source is 404.
- Real-runtime check in the Workers pool: a real `r2` source over a miniflare bucket serves
  `activate_skill` body and a resource; a refreshed registry shows the new text.

Frontend (user steps, on the beta deploy from #96, which is seeded from prod without chats):
1. Settings, Integrations, Add skills and commands, GitHub tab, paste a public repo, Scan.
2. Tick two skills and one command; open one to read it; Import.
3. Open the dev bot, enable both skills; send a chat that should trigger one; confirm the bot
   follows it.
4. Type `/`, pick the command with arguments, send; confirm the transcript text.
5. Push a change upstream; wait for the schedule or press Update now; confirm history, then the
   next turn's behavior; Roll back; confirm held; Update now.
6. Try a private repo with and without the App installed.

## Open items from requirements — resolved

1. **Turn-start check: keep it.** The requirement already asks for it, so it was never an owner
   question. The hook is `Bot.wake()` → `startRun()` (`bot/durable.ts:1305`). It only reads
   `last_checked_at` and dispatches the sync off the DO (`enable_ctx_exports` is already on); no
   download or extraction runs inside the Bot DO.
2. **Schedule interval: 15 minutes.** A GitHub conditional request that answers 304 is nearly free.
   One global throttle per source, not per bot; cap how many sources one tick processes.
3. **Commands follow skills for storage, history and rollback, but not the library.** Served from
   `import_items` + R2; hides in `bot_hidden_commands`. No `command` library kind, no manifest field.
4. **Branch-following only** — already out of scope per `requirements.md`.
5. **GitHub App: connected on prod.** Verified 2026-11-17: `owner_secrets` has `id='github-app'`,
   `kind='github-app'`, updated 2026-11-14 (prod and local). Beta needs #96's seed allow-list;
   whether a specific private repo is covered is answered in S9.

## Decisions from the advisor review (2026-11-17, Claude opus)

- **Uploads are never auto-updated** (owner's gate note, 2026-11-17): no scheduled check, no
  turn-start check, `last_checked_at` never moves; "Update now" is refused with a stated reason and
  the UI disables it. A commit is the upload's only version.
- **Rollback is per update, not per item.** The UI names every item it reverts. If the owner ever
  wants per item, the smallest change is `current_version`/`held_at` on `import_items` plus one `r2`
  source per `(sourceId, version)` group. Not built here.
- **Cron is proven on prod only.** #96's beta is a Worker Preview and previews support no
  `triggers`/`crons`. S5's handler is tested directly in the Workers pool; beta proves Update now,
  rollback and the turn-start path; the report says cron was proven on prod.
- **Source id carries the version** (`import:<sourceId>@<version>`, fingerprint the same) so a
  flipped prefix can never be deduped away. "A refreshed registry shows the new text" is a hard gate
  in the Workers pool, because the SDK's dedupe behaviour is not readable without `node_modules`.
- **Memory, not CPU.** The account is Workers Paid (30 s CPU, 1,000 subrequests), but every
  invocation still has 128 MB. Stream the archive through `DecompressionStream` with the byte cap
  enforced while streaming; never `arrayBuffer()` the whole tarball.
- **S9 depends on #61** (with #96) landing: beta does not exist on `main` yet. Both #61 and #88 append
  to `schema/v3.sql`, so whichever lands second takes a small merge.

## Base, build and verification

- **Worktree off `main`**, never the primary tree: `/root/Code/meta-agent-system` holds #61's
  uncommitted work on `feat/unbounded-tool-output` and is not a clean copy of the #61 branch. Build in
  `../meta-agent-system-88` on `feat/88-skills-commands-import`.
- `bun install` in the worktree root, `backend/` and `frontend/`. Copy `backend/.dev.vars` in (never
  print it). The worktree's `.wrangler` state is empty, so apply `schema/v3.sql --local` before any
  local run. `frontend/src/routeTree.gen.ts` is generated: `build:worker` before `type-check`.
- The dev servers on 8989/3001 are **not running** (checked 2026-11-17) and would serve the primary
  tree anyway. Nothing here may start, kill or restart them.

## Risks and spikes (do these first, they can change the plan)

- **Public repos through the App token.** The plan assumes an installation token of the owner's App
  can read **public** repos of other owners, which avoids the anonymous 60-requests-an-hour limit
  that shared Worker egress IPs would hit. Not verified. Spike in S2; fallback is anonymous plus
  conditional requests (a 304 is cheap) and a lower check frequency.
- **Does a bad `SKILL.md` ever throw out of the SDK `r2` index?** Spike in S1/S4 with a fixture. The
  import-time gate with the same parser is the mitigation either way.
- **Turn-start hook: resolved.** `Bot.wake()` → `startRun()` (`bot/durable.ts:1305`) is the single
  entry for chat, triggers and resumes. The check only reads and dispatches; it must never extract
  or write inside the DO, because the object is single-threaded and would stall the streaming turn.
- **Subrequest and CPU limits** for a large repo tarball in one invocation; the caps in S1/S2
  (files, bytes) are what keep this safe. Measure on beta.
- **Bundle size.** `fflate` and the importer add weight; the last measure was 11,037 KiB raw /
  2,220 KiB gzip. Paid gives 10 MiB gzip, so this is comfortable; report the delta anyway.
- **Prompt injection through upstream text** is accepted by the owner's decision; the history,
  rollback, trust notice and bot-cannot-edit rules are the whole defence. Say so in the report.
