# Pi mod-pack infrastructure findings

Verified against installed Pi **1.2.0** (repository dev dependencies pin **0.85.1**; installed types win). Commands were run from this worktree on 2026-06-12.

## 1. Configuration

Pi has no Claude-style extension-owned `userConfig` registry. `docs/settings.md` documents the settings schema and says `$schema` is for “editor validation and completion”; `docs/configuration.md` says options not exposed by `/settings` should be edited directly. There is no extension namespace in the documented settings list.

The installed published schema (`/root/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/schemas/settings.schema.json`) declares `type: "object"` and has no root `additionalProperties: false`; JSON Schema therefore permits unknown keys. It is editor validation, not an extension configuration registry. Experiment: a temporary `PI_CODING_AGENT_DIR/settings.json` contained `{"$schema":"https://pi.dev/schemas/settings.schema.json","definitelyUnknownPiKey":true}`. `pi --no-session --print --no-extensions --offline 'say ok'` exited 1 with `You have no credits remaining...`; no unknown-key diagnostic appeared. The experiment could not reach model execution, but the schema is definitive that it does not reject unknown keys.

Installed `dist/core/extensions/types.d.ts` declares `registerFlag(name, { type, default? })` and `getFlag`. `docs/cli.md` says extension flags appear in top-level help as additional long-form options: this is invocation-scoped CLI state, not persisted/discoverable user configuration.

`pi config --help` output:

```text
Usage:
  pi config [-l] [--approve|--no-approve]

Open the resource configuration TUI to enable or disable package resources.
Without -l, starts in global settings (~/.pi/agent/settings.json).
Press Tab to switch scope, or run pi config --local ...
```

`docs/packages.md` confirms package filters select individual `extensions`, `skills`, `prompts`, and `themes`. Thus `pi config` is the intended enable/disable surface for resources, not aggression sliders.

**Recommendation:** use an extension-owned `<name>.config.json`; use `ctx.ui.custom` only as an optional editor that writes it, and `registerFlag` only for temporary overrides. `extensions/shared/config.ts` implements defaults, validation, and errors. Resolution (highest precedence first): `<cwd>/.pi/<name>.config.json`, `<cwd>/<name>.config.json`, `$PI_CODING_AGENT_DIR/<name>.config.json` (default `~/.pi/agent`), then optional extension directory.

## 2. State and persistence

The authoritative `dist/core/extensions/types.d.ts` declares `appendEntry<T>(customType: string, data?: T): void`; its comment says custom entries are persisted “(not sent to LLM)”. It also declares `registerEntryRenderer` for `CustomEntry` and `registerMessageRenderer` for `CustomMessageEntry`.

`docs/extensions.md` maps tool state following the active branch to tool-result `details`, durable context-excluded state to `pi.appendEntry()`, model-visible content to `pi.sendMessage()`, and cross-session data to external storage. It explicitly says to reconstruct branch-sensitive state from `ctx.sessionManager.getBranch()` at `session_start`, not every file entry. Replaying all entries resurrects abandoned sibling history. `extensions/shared/state.ts` implements branch-only reconstruction and append helpers. Use an entry renderer when persisted state should be visible in the transcript.

Atom placement:

| Atom | Verdict |
|---|---|
| `usage` | Tool-result `details` for per-call usage; append a summary only if it must follow branches. |
| `aggression` | Module memory, or `appendEntry` when branch restoration matters. |
| `pet` | `appendEntry` plus an entry renderer: user-visible and branch-scoped. |
| `denies` | `appendEntry` for session denies; external storage only for intentionally global policy. |
| `duck` | Module memory, or tool-result `details` when tied to one invocation. |
| `harness` | External `~/.jev-harness/` state: cross-session coordination is not transcript state. |

## 3. Packaging and distribution

`docs/packages.md` gives the manifest fields: ordinary `package.json`, optional `keywords: ["pi-package"]`, and `pi: { extensions, skills, prompts, themes }`; paths are package-root relative and arrays accept filters. This repo already has five extension entries, `pi-package`, and `pi.image`. `pi.video` is optional; gallery readiness still requires publishing a discoverable package and maintaining public preview metadata.

The repo's `scripts/check-package.mjs` enforces the exact repository URL, exactly five manifest extensions, existing entry points, no test/activity/ui helper entries, and existence of README, preview HTML/SVG, and SECURITY. Shared helpers are not manifest entries, so no checker change is needed.

`docs/packages.md` says host packages (`@earendil-works/pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`, `typebox`) belong in `peerDependencies` with `"*"`, never `dependencies`: bundling them creates duplicate module roots, classes, registries, and initialization. This package already follows that rule (optional peer metadata is also present).

Versioned npm specs are pinned; git tags and commits are pinned and updates do not move a configured ref. Therefore `pi install git:github.com/PrashamTrivedi/Prasham-Pi-Extensions@v0.1.0` pins the selected tag/ref. `pi update --extensions` reconciles installed packages; `pi remove <source>` removes the package and settings entry. No version was bumped.

## 4. herdr gap list

`/root/.pi/agent/extensions/herdr-agent-state.ts` is explicitly marked “managed by herdr; reinstalling or updating ... overwrites this file”; the Claude shell hook has the same warning. **Do not edit either file.**

The Pi integration currently reports, over `HERDR_ENV`, `HERDR_SOCKET_PATH`, and `HERDR_PANE_ID`: root TUI `session_start` (`pane.report_agent_session`), `agent_start` (`working`), `agent_settled` (`idle`), and `herdr:blocked` transitions (`blocked`). It also sends no tool activity events.

Claude hook coverage is only root `SessionStart` (it rejects Cursor and subagents), reporting session id/path and source. Gaps: no Claude session-stop report; no Claude working/idle lifecycle report; no Claude blocked event equivalent; no Claude tool-start/update/end activity report. Pi counterparts that can supply them are `session_start`, `session_shutdown` (stop), `agent_start`/`agent_end` or `agent_settled` (activity/settled), and `tool_execution_start`/`tool_execution_end` (activity). `agent_settled` is the reliable final idle event per `docs/extensions.md`; `agent_end` can precede queued continuation.

Recommendation: coordinate with herdr to generate an updated managed integration, rather than patching the installed file.

## 5. Export/share versus transcript viewer

`docs/cli.md` documents `--export <input> [output]` as session-to-HTML export. `docs/sessions.md` says `/export` writes HTML or JSONL and `/share` uploads a viewer link (Radius artifact or private GitHub gist), and warns exports can contain prompts, responses, tool arguments, command output, file contents, and extension messages.

The custom `/root/claude-config-workspace/transcript-viewer/index.html` is not merely a renderer: it supports a multi-file/folder index, search/filtering, thinking/tool collapse, browser-persisted annotations, transcript-level evaluation, JSON note import/export, and redaction-like omission through filters. The corpus manifests enumerate chunk files, while `.skeleton.jsonl` files preserve metadata and replace tool payloads with stubs such as `"[reasoning not recorded — encrypted signature only in source transcript]"` and empty tool results. This is a privacy-preserving preprocessing pipeline plus corpus index.

**Verdict:** Pi `/export` HTML does not replace the custom viewer. It is a faithful single-session export/share mechanism; it does not provide the corpus manifest/index, skeleton-stub pipeline, annotation/evaluation store, or custom redaction workflow. Review exports before sharing as Pi explicitly warns.

## Evidence and verification status

Verified by reading: `docs/settings.md`, `configuration.md`, `packages.md`, `extensions.md`, `sessions.md`, `cli.md`, `compaction.md`; installed `dist/core/extensions/types.d.ts` and `dist/core/session-manager.d.ts`; the herdr files; the checker and package manifest; and the viewer/corpus files named above. `pi config --help` and `pi --version` were run (`1.2.0`). The unknown-settings experiment was blocked by the no-credits error, as recorded above. TUI rendering and interactive branch navigation were not executable in print mode; a human should check the optional config panel and custom entry renderer interactively.
