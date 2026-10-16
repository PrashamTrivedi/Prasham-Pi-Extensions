# Workbench (Pi-native port)

## Design

`extensions/workbench/index.ts` registers five independent Pi features. `pet` updates Pi's working message/indicator and status on turn/tool events; its 30 verbs are grouped as the three requested themes and selected per turn (unlike Claude's static settings list). `/pet theme ...` pins a theme and `/pet badges` toggles status badges. `cockpit` is a guarded `ctx.ui.custom()` screen. `ramp` publishes `workbench.ramp` on `pi.events`; `decorate` handles an in-process gate shape and post-result hook denials once per call. `statusline` replaces the footer with a width-safe two-line component.

## API calls verified

- `ctx.ui.setWorkingIndicator({ frames, intervalMs })`, `setWorkingMessage`, `setStatus`, `setHiddenThinkingLabel`, `setFooter`, `notify`, and `custom` are present in installed 1.2.0 `types.d.ts`.
- `ctx.getContextUsage()` exposes `tokens`, `contextWindow`, and `percent`.
- `ctx.sessionManager.getEntries()` exposes session entries; assistant message usage contains cost totals.
- `ctx.exec(command, args, { timeout })` is used for optional sqlite3 ledger reads.
- `pi.events.emit/on` is the installed event-bus API.
- TUI output uses `truncateToWidth`/`visibleWidth`; no component uses string length for terminal clipping.

## Verified vs assumed

Typechecking and tests verify the pure logic and signatures. Interactive rendering, `ctx.ui.custom`, footer repainting, theme changes, focus, and regular/fullscreen visual layout require a human run of Pi in TUI mode. The installed runtime is Pi 1.2.0 while this repo pins development dependencies to 0.85.1; installed declarations were treated as authoritative as requested.

Pi 1.2.0 does not expose Claude-style 5h/7d rate limits or a session usage aggregate API to extensions. Cockpit explicitly shows those quota windows as `n/a`, rather than inventing data. `ccusage` is also a Claude-specific executable and cannot be ported into a Pi extension without an external integration. Lines added/removed are not exposed in the extension context, so the status footer omits fabricated counts. The optional `sqlite3` query is non-fatal and depends on the `jev-harness` schema/CLI being installed.

The ramp therefore publishes an in-process signal, but quota-driven aggression cannot be fully computed from Pi's public 1.2.0 API; its current baseline remains conservative. A future Pi usage/rate-limit API can replace the calculation without changing consumers.

## Comparison

| Claude Code mechanism | Pi mechanism | Result |
|---|---|---|
| Static `spinnerVerbs.verbs` settings list | Per-turn `pickVerb()` over grouped constants | **Better**: mood and theme can choose each turn; this capability gain is proven in code. |
| JSX hook spinner/above-prompt rendering | `setWorkingIndicator`, `setWorkingMessage`, status | **Same** feedback with native lifecycle. |
| Claude pane event/render hooks | guarded `ctx.ui.custom()` cockpit | **Same** interactive pane, but requires TUI mode. |
| File `overrides.json` for ramp | `pi.events.emit("workbench.ramp", ...)` | **Better**: permission consumers read process-local state without stale files. |
| Post-tool decorate hook | `tool_call` block result plus `tool_result` toast classification | **Same** where a gate supplies the documented shape; Pi has no hook-denial envelope automatically. |
| Bash statusline + `ccusage` | `ctx.ui.setFooter(factory)` | **Worse** for ccusage/line diffs because Pi does not expose those values; better for theme/reactive rendering. |
| `tail`/Claude session usage | `getContextUsage` and session entries | **Worse**: only context and assistant cost are public. |

## Cannot port

- Claude `spinnerVerbs` settings integration itself (Pi has no equivalent settings field; the verb capability is implemented natively instead).
- Claude 5h/7d quota percentages and `SessionUsage` rate limits (not in Pi extension API).
- `ccusage` daily/block cost line without invoking an external Claude tool.
- Claude's hook-denial result shape as a universal Pi result; only explicit gate input and hook-like `tool_result` content can be classified.
- Exact added/removed line counts, because Pi extension types do not expose them.
- Claude-specific HUD/deploy/prompt/duck features; the requested scope is the five Pi features.
