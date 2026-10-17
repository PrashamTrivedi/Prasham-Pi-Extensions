# Workbench

One registered extension with feature flags (`workbench.config.json`), so features can be
toggled without adding extension entries. Each feature registers inside its own `try`; one
broken feature cannot take the others down, and failures are reported once at session start.

## Features

| Feature | Flag | What it does |
| --- | --- | --- |
| **Pet** | `pet` | Themed animated working indicator, per-turn verbs, mood from context fill and recent tool errors. `/pet` shows state. |
| **Statusline** | `statusline` | Two-line footer: branch, context %, duration and cost; then provider usage windows. |
| **Cockpit** | `cockpit` | A panel **docked above the editor** with context, provider usage windows, and recent decisions. |
| **Observability** | `observability` | MCP tool renderer, `/context` breakdown, and `/report`. |

## Commands

| Command | Purpose |
| --- | --- |
| `/cockpit` | Toggle the docked cockpit |
| `/pet` | Show pet state; `/pet theme <t>`, `/pet badges` |
| `/context` | Context-window breakdown |
| `/report` | Session report |

## Configuration

`workbench.config.json`, resolved project `.pi` → cwd → agent dir → extension dir:

```json
{
  "pet": { "enabled": true, "theme": "auto", "badges": true },
  "statusline": { "enabled": true, "showTokens": true },
  "cockpit": { "enabled": true },
  "observability": { "enabled": true }
}
```

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
