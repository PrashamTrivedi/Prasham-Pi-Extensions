# Purpose

Turn the `/btw` full-window side chat into a right-side 45% overlay panel so the
main chat stays visible, with a full-screen fallback on narrow terminals.

## Original Ask

The user's request, in their words:

> Can we have the TUI panel open in the side? Confirm this with sonnet

Sonnet (via the read-only Claude advisor; the Fabric subagent attempt hit
`402 Insufficient unified billing credits` on `cloudflare-ai-gateway`) confirmed:

- Pi has no true side-by-side split pane.
- The closest supported mechanism is `ctx.ui.custom` with `overlay: true` and
  `overlayOptions: { anchor: "right-center", width: "45%", minWidth: 44,
  maxHeight: "80%", margin: 1 }`.
- The overlay covers the right side of the main chat instead of reflowing it.
- `BtwScreen` must render its own panel height; the overlay `maxHeight` clips from
  the bottom, which would otherwise cut the input editor and footer.
- The full-screen lock and Fabric-row hiding are wrong for the overlay path; they
  belong only on a narrow-terminal full-screen fallback.

The human then chose: **Implement — 45%**, with the full-screen fallback below 100
columns.

Interpreted as one outcome: **BTW opens as a right-side 45% overlay on terminals
≥100 columns, with a full-screen fallback below 100; the main chat remains visible
on the left, input is captured by the panel, and the existing transcript-only,
no-session-write, Alt+S/send-summary behavior is preserved.**

## Complexity and the reason behind it

**Score: 2 / 5.**

- A focused UI refactor of an already-shipped extension: view renderer, screen
  height/mode, overlay options, and a layout helper.
- No new dependency, no session/schema change, no model-path change.
- Verification is unit tests for the panel renderer/height and the existing
  transcript/model/prompt tests, plus a live TUI check at wide and narrow widths.

## Current-state findings

1. `/btw` opens with `ctx.ui.custom` as a **full-window screen**
   (`extensions/btw/index.ts`), takes the shared full-screen lock
   (`beginFullScreen`/`endFullScreen`), and hides `pi-fabric-agents`.
2. `BtwScreen.render` always uses `windowHeight(tui.terminal.rows)`
   (`extensions/btw/screen.ts`), which is wrong for an overlay: the overlay gives
   the component a width, not a height, and `maxHeight` truncates returned lines
   from the bottom.
3. `renderBtwView` is a pure, width-safe full-screen view with a header, rule,
   body, editor rows, and footer. It has no background fill, so it would float over
   the chat unreadably.
4. `extensions/shared/panel.ts` already provides `renderPanel`: a rounded,
   background-filled frame whose every line is exactly `width` visible columns.
   The cockpit and duck use it. It is the right chrome for a side panel.
5. Sonnet confirmed there is no split-pane API; a true left/right split would
   require replacing Pi's interactive layout, which is out of scope and unsafe.
6. `process.stdout.columns` is the same source Pi's terminal uses
   (`pi-tui/dist/terminal.js`), so it is a reliable way to choose overlay vs
   full-screen at open time.

## Architectural changes required

- New `extensions/btw/layout.ts`: the overlay/full-screen threshold and the exact
  overlay options, so the decision is testable and documented.
- `extensions/btw/view.ts`: add `renderBtwPanel` using `renderPanel`; keep
  `renderBtwView` as the full-screen fallback.
- `extensions/btw/screen.ts`: add `mode: "full" | "panel"` and a `height` function;
  panel mode renders the editor at the panel's inner width and asks
  `renderBtwPanel` for exactly `height(rows)` lines.
- `extensions/btw/index.ts`: choose the mode from the terminal width; pass overlay
  options in panel mode; keep the full-screen lock/widget hiding only for the
  fallback.
- No changes to transcript, model, prompt, summary, or `shared/full-screen.ts`.

## Backend changes required

None.

## Frontend changes required

### Layout helper (`extensions/btw/layout.ts`)

- `BTW_OVERLAY_MIN_COLUMNS = 100`.
- `btwMode(columns): "panel" | "full"` — panel at ≥100, full otherwise.
- `BTW_OVERLAY_OPTIONS`:
  ```ts
  { anchor: "right-center", width: "45%", minWidth: 44,
    maxHeight: "80%", margin: 1 }
  ```
- `terminalColumns()` helper using `process.stdout.columns ?? COLUMNS ?? 80`.
- Tests for 120/100/99/80 columns and the exact option values.

### Panel renderer (`extensions/btw/view.ts`)

- Extend `BtwTheme` with `bg(color: ThemeBg, text: string)` and use the shared
  `ThemeColor` / `ThemeBg` types so the real Pi theme is structurally compatible.
- `renderBtwPanel(input, theme, width, height): { lines, maxOffset, bodyRows }`:
  - `contentWidth = max(1, width - 3)` (two borders + one leading frame space).
  - Render the transcript with the existing `bodyLines` at `contentWidth`.
  - `bodyRows = max(1, height - 4)` for the frame top, footer rule, footer, and
    bottom.
  - Keep the input editor at the bottom: `transcriptRows = max(1, bodyRows -
    inputLines.length - 1)`; cap input lines to `bodyRows - 2` so a tiny panel
    still shows the editor.
  - Apply the scroll offset to the transcript only, pad the transcript window, add
    one blank row, then the editor lines.
  - `renderPanel(theme, width, { title: "◆ BTW · side chat", right: model,
    body, footer, limit: bodyRows })`; truncate the footer to `contentWidth`.
  - Return `lines` exactly `height` tall and `width` wide, the transcript
    `maxOffset`, and the transcript row count for paging.
- `renderBtwView` stays for the full-screen fallback; no behavior change.

### Screen (`extensions/btw/screen.ts`)

- `BtwScreenOptions` gains `mode?: "full" | "panel"` and
  `height?: (rows: number) => number`.
- Default mode `full`, default height `windowHeight`.
- `render`:
  - `contentWidth = mode === "panel" ? max(1, width - 3) : width`.
  - Render the editor at `contentWidth`.
  - Panel: call `renderBtwPanel` with `height(tui.terminal.rows)`; do not use
    `fitScreen`.
  - Full: keep the existing `renderBtwView` + `maxInputRows` slicing.
  - Store the returned transcript `maxOffset`/`bodyRows` for PageUp/PageDown.
- Editor focus, Enter, Alt+S, Esc, scrolling, and the test editor seam are
  unchanged.

### Command/controller (`extensions/btw/index.ts`)

- `const columns = terminalColumns(); const mode = btwMode(columns);`
- Panel mode:
  - `ctx.ui.custom(factory, { overlay: true, overlayOptions: BTW_OVERLAY_OPTIONS })`.
  - Create `BtwScreen({ mode: "panel", height: (rows) => max(8, floor(rows * 0.8) - 2) })`.
  - Do **not** call `beginFullScreen`, hide `pi-fabric-agents`, or take the
    full-screen lock.
- Full-screen fallback (<100 columns):
  - Keep the current `beginFullScreen`/`endFullScreen` + widget hiding and
    `BtwScreen({ mode: "full" })`.
- Both modes share the ask/stream/summary/abort/`pending` controller.
- The command description mentions the side panel; `/btw help` is unchanged.

### Docs

- `docs/btw.md`: side-panel default, 45% width, ≥100-column threshold, full-screen
  fallback, right-side occlusion, input capture, Fabric rows staying visible,
  no true split pane, and how to close (`Esc`).
- `README.md` BTW section and `CHANGELOG.md` bullet.
- `docs/shared.md` already lists `full-screen.ts`; no change needed.

## Acceptance Criteria

1. On a terminal with ≥100 columns, `/btw` opens as a right-side overlay at 45%
   width, with the main chat still drawn on the left.
2. The panel is framed/background-filled (`renderPanel`), exactly the overlay
   width, and exactly the computed panel height; the editor and footer are never
   clipped by `maxHeight`.
3. The panel captures input while open: Enter asks, Alt+S stages a summary, Esc
   closes; the main editor receives input again after close.
4. Below 100 columns, `/btw` falls back to the existing full-window screen, takes
   the full-screen lock, and hides Fabric rows.
5. Panel mode does not take the full-screen lock and does not hide Fabric rows; the
   overlay may cover part of the rows.
6. The existing transcript-only, free-model, summary, no-session-write, and
   main-chat-only guards are unchanged.
7. `npm run check` passes with new tests for `btwMode`, the overlay options, the
   panel renderer, and the screen's panel height/width.

## Validation

- `npm run check` — typecheck exit 0 and a `N pass, 0 fail` summary.
- `tests/btw/layout.test.ts` — mode threshold and exact overlay options.
- `tests/btw/view.test.ts` — panel exact height/width, frame/background, editor at
  the inner width, scroll, footer/notice, narrow width.
- `tests/btw/screen.test.ts` — panel mode renders `height(rows)` lines, editor
  width is `width - 3`, PageUp/PageDown use the transcript rows, focus/keys still
  work; full mode still uses `windowHeight`.
- `tests/btw/extension.test.ts` — unchanged main-chat guard/non-TUI paths.
- Live TUI at 120×40: `/btw` shows the right-side panel with the main chat visible;
  ask a question; Alt+S stages the editor summary. Live TUI at 90×30: `/btw` falls
  back to the full-window screen.
- `taskNotes/btw-side-panel/frontend-validation.md` records the raw evidence.
- `taskNotes/btw-side-panel/taskWalkthrough.md` records the human steps.

## Out of scope

- A true split-pane/reflow layout; Pi has no API for it.
- A draggable/resizable panel; the width is fixed at 45%.
- `nonCapturing` display-only mode; the panel must own input for the side chat.
- Changing the free-model policy, transcript scope, summary format, or persistence.
- Making the side panel survive `/agents` or stacking it with other overlays.
