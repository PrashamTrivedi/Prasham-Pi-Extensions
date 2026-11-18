# #88 (with #89): Import skills and commands

Status: requirements, agreed with the owner on 2026-11-17. Replaces the defaults in last night's
mock where they differ (see "What changed since the issue and the mock").

## Goal

The owner can bring skills and slash commands into the platform from where they already live,
instead of pasting each one by hand, and can see and control what came in.

- A **skill** is text a bot activates by itself when it fits the job.
- A **command** is a saved prompt the owner types in the chat box (for example `/review src/foo`).
  The owner chooses to run it; the bot never does.

## Who and where

One owner. Imports happen from the library screen in the app. Skills are then switched on per bot.
Commands are available in every bot's chat box.

## What the owner can do

1. **Add from a source.** Choose where the items come from:
   - a GitHub repository (owner/repo, branch or tag, optional folder);
   - a web address pointing at one file or one archive;
   - a file uploaded from the device.
2. **See what was found before anything is saved.** The screen lists every skill and command found,
   each with a tick box. The owner can open any item to read its full text. Items that cannot be
   imported are listed with the reason; one bad item never blocks the others.
3. **Import the ticked items.** Each saved item remembers where it came from and which version
   (commit) it came from.
4. **Private repositories.** Supported when the platform's existing GitHub connection already has
   access to that repository. If the connection is missing or lacks access, the owner is told that
   plainly and nothing is imported. No new way of storing credentials is added for this.
5. **Skills stay off until switched on.** Imported skills do nothing on any bot until the owner
   enables them for that bot. This is a platform-wide rule, not a per-import setting.
6. **Commands in the chat box.** Typing `/` offers the list of commands with their descriptions.
   Choosing one fills the text, including any arguments the owner types, into the message. What is
   sent is ordinary message text, so the conversation shows exactly what was run. The owner can hide
   a command for a particular bot.
7. **Updates arrive on their own.** When the source changes, the imported item changes from the next
   chat turn onward. No owner approval is needed.
   - Changes are noticed when a turn begins, at most once per short interval, and also on a regular
     schedule, so a quiet bot still catches up.
   - The owner can also press **Update now** on any source at any time.
8. **Updates are visible and reversible.** Every automatic or manual update is recorded: which item,
   the old and new version, when, and what changed. The library shows this history. One action rolls
   an item back to its previous version.
9. **Removing a source.** The owner can remove a source and everything it brought in, with a
   confirmation that names what will go.

## What must be told to the owner plainly

- Which parts of a skill were **not kept** on import (see "Skills that carry extra files").
- Which commands or lines use features that do not work here (see "Command files").
- That a skill is text a bot will obey, so what an upstream source says becomes the bot's
  instructions. This appears once, where the owner first turns a source's skills on.

## Skills that carry extra files

A skill folder may contain reference files and scripts alongside its main text.

- Reference files are kept with the skill and available to the bot.
- Scripts are kept but **cannot run yet**; running them belongs to the later executable-skills work.
  Any skill that contains scripts is flagged on the import screen and in the library.

## Command files

Claude Code style command files may use shell expansion lines, file includes, a tool allowlist and a
model choice.

- Description, argument hint and the body are imported.
- Shell expansion lines and file includes are kept as **plain text** (not executed, not removed). The
  import screen warns that those lines will not do anything here.
- The tool allowlist and the model choice are ignored, and the screen says so.
- Argument placeholders (`$ARGUMENTS`, `$1`, `$2`, ...) are filled from what the owner types.

## Rules for every import

- A skill or command that is malformed, empty or too large is skipped with a stated reason and the
  rest still import.
- If two items share a name, the owner is told and chooses which to keep; nothing is overwritten
  silently.
- Where the repository layout is ambiguous, these are recognised: skill folders anywhere under the
  repository, and command files in a `commands` folder. Plugin manifests and other layouts are out.
- The importer is built once for both kinds so that other kinds can be added later.

## Acceptance

- Import a real public repository that holds skills and commands; tick two skills and one command.
- Enable both skills on the dev bot. In a live chat the bot activates and follows them. The command
  appears in the chat box, expands with arguments, and the transcript shows the expanded text.
- Change a skill upstream. The new text is in effect on the next turn with no action by the owner,
  and the history shows the old and new version.
- Roll that skill back from the library; the next turn uses the previous version.
- Press **Update now** on a source and see the same result immediately.
- A malformed file in the same repository is skipped with a reason; the others import.
- A skill with a script is flagged and its script does not run.
- Import from a private repository the connection can reach; and refuse clearly when it cannot.
- Backend and frontend suites pass (one at a time), and the added weight to the platform bundle is
  reported.

## Decisions made on 2026-11-17

| Question | Decision |
|---|---|
| Where imported skills are kept | In the platform's skill storage so reference files are kept now (not as body-only library entries) |
| Private repositories | Yes, if the existing GitHub connection can reach them right now |
| Owner approval before an update takes effect | None. Changes apply from the next turn; safety comes from a visible history and one-click rollback |
| How updates are noticed | Scheduled check plus a manual **Update now** button (the turn-start check is also wanted; see open items) |
| Scope | Skills and commands together |
| What a command is | The chat box fills in ordinary message text; available on every bot with an optional hide per bot |
| Unsupported command syntax | Imported as plain text, with a warning |
| Skills default | Off everywhere until the owner enables them per bot |

## What changed since the issue and the mock

- The issue recommended library entries, public-only and an explicit accept on updates. The owner chose
  skill storage with reference files, private repositories when reachable, and automatic updates.
- Commands were a separate task (#89); they are now part of this one, so #89's open design questions
  are answered above.
- Last night's mock showed an update diff that waits for accept. That screen becomes a history with
  rollback.

## Open items (need the owner's word, defaults assumed meanwhile)

1. **Turn-start check.** The owner answered "scheduled check plus a manual action". The default
   assumed here also includes the turn-start check because "from the next turn" is not reachable by a
   schedule alone. Confirm or drop it.
2. **Schedule interval.** Assumed: every 15 minutes for every source.
3. **Command storage follows skills** (same place, same update and rollback). Assumed.
4. **Following a branch** is the default for a source; pinning to a specific tag or commit is a later
   option and is not built here.
5. **Private repositories need the GitHub connection to be set up on the deployed platform.** Not
   verified yet; check before promising the acceptance line for private repos.

## Out of scope

- Running skill scripts (executable skills, #61).
- Promoting skills into the platform home, and a bot-proposed skill change (roadmap item 16).
- Coach-proposed skill edits (roadmap item 17).
- Plugin manifests and any other repository layout.
- Per-bot command opt-in (only a hide), and server-side command expansion.
