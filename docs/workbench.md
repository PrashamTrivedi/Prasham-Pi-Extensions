# Workbench

One registered extension with feature flags (`workbench.config.json`), so features can be
toggled without adding extension entries. Each feature registers inside its own `try`; one
broken feature cannot take the others down, and failures are reported once at session start.

## Features

| Feature | Flag | What it does |
| --- | --- | --- |
| **Pet** | `pet` | Themed animated working indicator, per-run verbs, mood from context fill and recent real tool failures. Sub-flags: `art` (8x4 half-block theme badge below the editor while a run works; Marvel cycles stones), `signOff` (footer line `Pip: Pressed high for 2m14s` using the run's verb), `lines` (short pet lines on every third run when stuffed or sad). `/pet` shows state. |
| **Statusline** | `statusline` | Two-line footer: branch, context %, duration and cost; then provider usage windows. |
| **Cockpit** | `cockpit` | A panel **docked above the editor** with context, provider usage windows, and recent decisions. |
| **HUD** | `hud` | Cards from the shared drop dir `~/.workbench/hud/*.json` (`WORKBENCH_HUD_DIR` overrides), the same files and schema the Claude Code workbench reads, shown in the cockpit. Toasts when a known source moves to ok/warn/error. `/hud`, `/hud <source>`. |
| **Deploy tracker** | `deploy` | A successful `wrangler deploy` / `versions upload` in bash records worker, commit and time per wrangler root (session state) and publishes HUD card `deploy-<name>` (ttl 1h). Later `git commit/merge/pull/rebase/cherry-pick` update it to "N commits not deployed". |
| **Verdict toasts** | `decorate` | A tool call blocked by `sandbox-dev` or a jev gate shows one pet-voiced warning toast per call. |
| **Observability** | `observability` | MCP tool renderer, `/context` breakdown, and `/report`. |

## Commands

| Command | Purpose |
| --- | --- |
| `/cockpit` | Toggle the docked cockpit; `/cockpit full` / `/cockpit compact` switch the view |
| `/pet` | Show pet state; `/pet theme <t>`, `/pet badges` |
| `/hud` | List HUD cards; `/hud <source>` opens one in an overlay (Esc closes) |
| `/context` | Context-window breakdown |
| `/report` | Session report |

## Configuration

`workbench.config.json`, resolved project `.pi` → cwd → agent dir → extension dir:

```json
{
  "pet": { "enabled": true, "theme": "auto", "badges": true, "art": true, "signOff": true, "lines": true },
  "statusline": { "enabled": true, "showTokens": true },
  "cockpit": { "enabled": true, "mode": "compact", "maxRows": 8 },
  "observability": { "enabled": true },
  "hud": { "enabled": true, "pollSec": 5 },
  "deploy": { "enabled": true },
  "decorate": { "enabled": true }
}
```

## HUD

Cards use the Claude-side schema (`source`, `title`, `status` running|ok|warn|error|idle, `progress`,
`lines` (last 3), `sections`, `detail`, `updatedAt`, `ttlSec`; default ttl 15 min). Card style:
`/root/claude-config-workspace/mods/workbench/HUD.md`. Cards past their ttl are hidden; order is
error, warn, running, idle, ok. The parser is a copy of the Claude one (`hud-logic.ts`), not an import.

The cockpit polls the dir on its normal refresh (turn end, tool result) and on a light timer
(`hud.pollSec`, default 5s) that exists only while the cockpit is shown. With the cockpit off,
the feed is polled on turn end so toasts still fire. The first sighting of a source never toasts.

`/hud <source>` matches by exact source, prefix, then substring of source or title. The detail
overlay shows status, lines, sections (open ones expanded; keys `1`-`9` toggle) and `detail` text;
`Esc` closes, arrows and page keys scroll.

## Deploy tracker

Pure command and output parsing is in `deploy-logic.ts` (mirrors the Claude `deploy-logic.ts`, plus
`versions upload` and worker-name extraction from wrangler's output). Only a non-error bash result
whose output contains a wrangler success line is recorded. Records are written with `pi.appendEntry`
(`workbench-deploys`) and restored from the active branch at session start.

## Verdict toasts

Pi turns a blocked call into an errored tool result whose text is the block reason. Reasons starting
with `sandbox-dev`, `jev...` or `blocked` toast `Pip: <line> <reason>`; the same text is never counted
as a pet failure. A bash exit 1 with no output (grep with no match) is not counted either.

## Size

The cockpit starts **compact**: one colored usage line (`◈ ctx 62% · rolling 2% · weekly 10%`;
each percentage green below 50, yellow 50–79, red from 80; a dim `usage ?` if the provider call
failed), then the latest HUD cards, at most 2, one line each (glyph, title, first card line, age;
newest first, errors and warnings first on ties; no line at all when there are no cards). Tokens
and decisions live in the full view. Below 60 columns it is a single line with a `hud 2 (1!)` count.
`/cockpit full` shows the framed panel, capped at
`cockpit.maxRows` body rows (default 8, range 3–30) with a `+N more` line; `/cockpit compact`
goes back. `cockpit.mode` sets the starting view.

## Docking, not floating

The cockpit used to be a floating overlay that covered transcript lines. It is now a
`ctx.ui.setWidget(..., { placement: "aboveEditor" })` panel: it reserves layout space, never
covers the transcript, and is shown automatically at session start when `cockpit.enabled`.
Because widgets take no keyboard focus, `/cockpit` is the only control.

Widgets get no `visible(width)` gate, so below 60 columns the cockpit collapses to a single
summary line instead of consuming rows. It is re-rendered on `turn_end` and `tool_result`,
and removed on `session_shutdown`.

## Degradation

With every flag `false` the extension loads and does nothing. In `print`/`rpc` without a UI,
no widget is installed. A missing config file falls back to defaults.

## Manual checks (TUI)

- At session start the cockpit appears docked above the editor without covering the transcript.
- `/cockpit` hides it, and `/cockpit` again restores it.
- Below 60 columns the cockpit collapses to a single summary line.
- Provider usage windows fill in while opencode-go is the active model.
- With `cockpit.enabled: false`, nothing is docked.
- A card dropped with `hud set demo --status running` appears in the cockpit; `hud ok demo` toasts once.
- `/hud demo` opens an overlay; `Esc` closes it and focus returns to the editor.
- The pixel badge appears below the editor during a run and disappears at the end; the footer shows the sign-off.
- A denied sandbox-dev prompt shows one pet toast.
- A real `wrangler deploy` creates a `deploy-<name>` card.
- The pet animation and two-line footer render; switching branches repaints the footer.
