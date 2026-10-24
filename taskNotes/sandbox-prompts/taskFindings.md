# Purpose

Cut sandbox-dev's permission prompts down to genuinely risky actions: stop confirming reads
outside the working directory, allow writes under a few trusted roots, and trim the `bash.confirm`
list so installs and network calls are judged by Jev instead of a deterministic prompt.

## Original Ask

Recorded requirement (memory `next_sandbox_dev_prompt_reduction`), verbatim:

> **Where the prompts come from today** (`extensions/sandbox-dev/policy.ts`, `DEFAULT_CONFIG`):
>
> 1. `paths.confirmOutsideCwd: true` — any `read`/`write`/`edit` outside cwd confirms. In practice this
>    fires on: reading a skill (`~/.pi/agent/skills/<name>/SKILL.md`), reading jev-harness sources
>    (`~/.claude/skills/jev-harness/...`), writing project memory
>    (`~/.pi/agent/projects/<slug>/memory/*.md` — the memory system added 2026-10-24), and any `/tmp`
>    scratch file. Reads are non-mutating, so this is the single biggest source of noise.
> 2. `bash.confirm` substring list — `curl`, `wget`, `npm install`, `npm i `, `bun add`, `pnpm add`,
>    `yarn add`, `docker`, `brew`, `apt-get`, `chmod`, `chown`, `git push`, `git reset --hard`, `rm -rf`,
>    `rm -r `, `sudo`. Installing a package or curling localhost does not need a human in this setup.
> 3. Matching is case-insensitive substring, so `"curl"` also fires on commands that merely mention it
>    (`grep curl`, `echo "curl ..."`), and `"rm -r "` fires on any recursive removal.
>
> **Already in place, so these are redundant:** `jev-gate` runs shell-safety/outbound-leak on every
> `tool_call` (with `sandbox-dev` marking handled shell approvals so the human sees one prompt, not two),
> and `sandbox-dev`'s deny list already covers `.env`, `.ssh`, `id_rsa`, `.aws`, `.npmrc`, `.netrc`,
> `.git-credentials`, `rm -rf /`, `sudo rm`, `mkfs`, fork bomb, force push.
>
> **Planned changes:**
> - Reads outside cwd: allow always (never confirm); keep denies for protected paths.
> - Writes: allow inside cwd plus an allowlist of roots — Pi agent dir (`~/.pi/agent`), `/tmp`, and an
>   env-extensible list (`PI_SANDBOX_ALLOW_ROOTS`), which only relaxes `confirm`, never `deny`.
> - Trim `bash.confirm` to genuinely destructive/side-effectful commands (`sudo`, `rm -rf`, `git reset
>   --hard`, `git push --force` stays deny, publish/deploy). Let Jev shell-safety judge installs and
>   network calls contextually instead of a deterministic prompt.
> - Replace substring matching with word-boundary matching for command patterns so `grep curl` stops
>   matching, and add tests in `tests/sandbox-dev/policy.test.ts`.
> - Instrument first: count confirms per session (a `/dev-status` line or a log) to show before/after.
>
> **How to apply:** keep `deny` immutable (no project file may zero it — that is a locked design decision in
> policy.ts), make only the confirm tier relaxable, keep the sandbox-dev/jev-gate single-prompt handshake,
> and follow the local-first rule: change this package, `/reload`, verify in this repo, then promote.

## Complexity and the reason behind it

**2 / 5.** One file owns the policy (`extensions/sandbox-dev/policy.ts`), one consumes it
(`index.ts`, for the new counter and its `/dev-status` line), and one test file covers it. No
schema, no new dependency, no new abstraction beyond a command matcher. Verification is a test
suite plus one interactive confirmation class.

## Architectural changes required

None. `PolicyConfig` gains one field and loses one (`paths.confirmOutsideCwd` →
`paths.writeAllowRoots`); `classifyToolCall` keeps its signature and its allow/confirm/deny
contract, and `strongest` / pass-2 escalation is untouched. Protected-path `deny` stays
substring-based and fail-safe; only the confirm tier becomes narrower.

## Backend changes required

`extensions/sandbox-dev/policy.ts`:

1. **Config.**
   - `paths`: keep `deny`; replace `confirmOutsideCwd: boolean` with
     `writeAllowRoots: string[]`. Defaults: `join(homedir(), ".pi", "agent")`, `/tmp`, plus
     `process.env.PI_SANDBOX_ALLOW_ROOTS` split on `delimiter` (`:`) with entries filtered to
     absolute, non-empty paths.
   - `bash.confirm`: trim to `sudo`, `rm -rf`, `rm -r`, `git reset --hard`, `git push`, `chmod`,
     `chown`, `npm publish`, `pnpm publish`, `yarn publish`, `bun publish`. Removed: `curl`,
     `wget`, `npm install`, `npm i `, `bun add`, `pnpm add`, `yarn add`, `brew`, `apt-get`,
     `docker`. `git push` stays because it is a shared-state side effect — but it is now
     Jev-resolvable, so a safe push is auto-approved instead of prompting.
   - `bash.deny` unchanged (substring, fail-safe over-match).
2. **New `matchCommand(value, pattern)`.** Slash-delimited patterns stay regexes; literal
   patterns are escaped, whitespace runs become `\s+`, and the result is anchored with
   `(?<![\w./-])` / `(?![\w/-])` so a pattern matches a whole token sequence. `grep curl`-style
   mentions, `git pushy`, and `rm -rf` matching the `rm -r` rule stop matching. Used for the
   confirm list only; `bash.deny`, path patterns, and `IMPLEMENTATION_BASH` keep `matchPattern`.
3. **`classifyToolCall` path branch.**
   - `read`: protected-path denies only, then allow — a read never confirms.
   - `write` / `edit`: protected-path denies, then allow when inside cwd **or** under a
     `writeAllowRoots` entry, else confirm with the existing reason/flags.
   - Add `isUnderAnyRoot(rawPath, roots)` helper (tilde/absolute/relative aware).

`extensions/sandbox-dev/index.ts`:

4. Count pass-1 confirm verdicts and how many of them Jev auto-resolved, per session; show a
   `policy: N confirm(s), M auto-approved (Jev)` line in `/dev-status` even when no plan is
   anchored. Reset the counters on `session_start` and `/dev-reset`. This is the before/after
   instrument.

## Frontend changes required

None. Text-only status line via `ctx.ui.notify`.

## Acceptance Criteria

Complexity is 2, so the criterion is complete satisfaction of `Original Ask`:

- A `read` of a skill, jev-harness source, memory file, or `/tmp` path never reaches
  `ctx.ui.confirm`.
- A `write`/`edit` inside cwd, under `~/.pi/agent`, or under `/tmp` is allowed; anywhere else
  still confirms; `~/.ssh/id_rsa` and `.env` still deny.
- `curl`, `wget`, `npm install`, `bun add`, `docker`, `brew`, `apt-get` no longer confirm;
  `sudo`, `rm -rf`, `git reset --hard`, publishes, `chmod`, `chown` still do.
- Commands that merely mention a pattern (`grep curl`, `git pushy`) do not confirm.
- `git push --force` still denies; the shell-confirm → Jev handshake and
  `markShellApprovalHandled` are unchanged.
- `/dev-status` reports the confirm/auto-approved counters.
- `npm run check` is green with new tests in `tests/sandbox-dev/`.

## Validation

- `tests/sandbox-dev/policy.test.ts`: `matchCommand` (token boundaries, whitespace runs, regex
  form, `rm -r` not swallowing `rm -rf`), read-outside-cwd allows, write-allow-root allows,
  write-elsewhere confirms, deny beats allow-root, trimmed/kept confirm entries, `git push
  --force` deny.
- `tests/sandbox-dev/extension.test.ts`: `/dev-status` counter line (no anchor and anchored),
  counters reset by `/dev-reset`.
- `npm run check` → 0 failures; then `/reload` in this repo and read a skill file, a memory file,
  and run `npm install`-free command to confirm no prompt appears.
