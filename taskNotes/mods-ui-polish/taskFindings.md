# Purpose

Fix the three reported mods defects: overlays that read as "CLI in CLI", an
unusable `/duck` panel, and a cockpit that needs better visual hierarchy and UX.

## Original Ask

The user's requirements, in their words:

> "ISsue in mods. 1: They look like CLI in CLI, there is no distinction between
> main content area and cockpit/duck. 2: Duck is unusable, when it shows
> question, I can;t interact with anything. 3. Cockpit can be and must be bteter
> visually and UX wise"

Interpreted as one outcome: **the cockpit and duck overlays must be visually
distinct from the transcript and pleasant to use, and `/duck` must be fully
interactive.**

## Feedback log (not scope)

Deliberately outside `Original Ask` so the gate's outcome anchor never picks up
review chatter:

> "g: Most of the edge cases won't appear to us.. but thanks for pointing them
> out"

Folded in as: **do not add defensive machinery for cases that cannot occur in a
real TUI session.** The edge-case list was informational (proof the plan had been
thought through), not a work queue. Only the reachable cases below are built and
tested; the rest are explicitly **not exercised and not handled specially**:

| Reachable — handled | Not reachable — no special handling |
|---|---|
| `percent: null` (before first usage read) | viewport overflow after an extreme resize race |
| ledger server down → visible error row | `done()` re-entrancy from two input sources at once |
| provider usage absent / error note | non-TTY / RPC key encodings |
| terminal resize while streaming | unbounded body growth beyond the window |
| widths 40–200; light + dark themes | exotic modifyOtherKeys variants |
| empty decision list | — |

This narrows the acceptance criteria to the observable asks; the panel kit still
keeps a clamp and a `done()` guard because they are one line each, not features.

## Complexity and the reason behind it

**Score: 3 / 5.**

- Two overlay components plus one new shared renderer, three test files, and a
  real input bug rooted in terminal protocol behavior.
- Verification is split: pure logic is unit-testable, but overlay placement,
  theme rendering, and animation require the documented manual TUI checklist.
- No data model, config, or backend changes; no new dependency.

## Root-cause findings (bugs)

Written in full to `taskNotes/mods-ui-polish/triageReport.md`. Summary:

1. **"CLI in CLI".** `buildCockpitLines` and `buildPanelLines` return plain,
   unstyled strings; the render callbacks only `truncateToWidth` them. There is no
   border, title, background, section, or spacing, so the overlays blend into the
   transcript instead of reading as panels.
2. **Duck unusable.** `handleInput` compares **raw byte sequences**
   (`data === "\u001b[A"`, `data === "\u001b"`). Pi enables the Kitty keyboard
   protocol (flags `7`) on supporting terminals (`pi-tui/dist/terminal.js`
   `DESIRED_KITTY_KEYBOARD_PROTOCOL_FLAGS = 7`), where arrows and Escape arrive as
   CSI-u sequences (`\x1b[1;1A`, `\x1b[27u`). None of the raw comparisons match,
   so scrolling and Escape silently do nothing; only `j/k/g/G/q` work. The panel
   is capturing, so the editor is frozen at the same time — the reported
   "can't interact with anything".

## Architectural changes required

- **Add one shared UI kit: `extensions/shared/panel.ts`.** A themed, bordered,
  background-filled panel renderer used by both cockpit and duck, so the two
  overlays look like one family and remain testable without a live TUI.
- **Duck becomes a key-mapped interactive panel** using pi-tui's
  `matchesKey` (protocol-agnostic) instead of raw comparisons.
- No change to the extension manifest; `shared/` stays a library, never an entry.

### `extensions/shared/panel.ts` (new)

```ts
export interface PanelTheme {
  fg(color: ThemeColor, text: string): string;
  bg(color: ThemeBg, text: string): string;
}
export const PANEL_BG: ThemeBg = "toolPendingBg"; // neutral, defined in dark+light

export interface PanelView {
  title: string;
  right?: string;        // right-aligned title-bar label (muted)
  body: string[];        // rows, wrapped to inner width by renderPanel
  footer?: string;       // one dim hint row inside the frame
  offset?: number;       // body viewport start
  limit?: number;        // body viewport height (pads to a fixed frame when set)
}
export interface PanelLayout { lines: string[]; offset: number; limit: number; total: number }

export function renderPanel(theme: PanelTheme, width: number, view: PanelView): PanelLayout;
export function meter(theme: PanelTheme, percent: number | null, cells: number): string;
```

Rendering rules:
- `inner = width - 2`; every line is exactly `width` visible columns.
- Top: `╭─ <title> ─── <right> ─╮` — title `accent`, `right` `muted`, rules
  `borderAccent`.
- Body rows: `│` `borderMuted` + background-filled, ANSI-aware padded content +
  `│`. Background uses `theme.bg(PANEL_BG, …)`; theme `fg()` resets to `\x1b[39m`
  and `bg()` to `\x1b[49m`, so nesting is safe.
- Row string must be `truncateToWidth(" " + content, inner, "…", true)` then
  padded with `visibleWidth` — never `String.length`.
- Footer: separator `├───┤` + one `dim` row; bottom `╰───╯`.
- `meter`: color by pressure (`success` <50, `warning` <80, else `error`), shape
  `████░░░░ NN%`.

### Cockpit (`extensions/workbench/cockpit.ts`)

- Replace `buildCockpitLines` with two separable pieces:
  - `buildCockpitSections(input): { right?: string; body: string[]; footer: string }`
    — pure, no ANSI, unit-tested.
  - `renderCockpitPanel(theme, width, input): string[]` — composes sections through
    `renderPanel`.
- Layout: context meter + token count; provider usage windows; "recent decisions"
  rows (`• decision · tool`); footer `· /cockpit to hide · refreshes each turn`.
- Keep: right anchor, `width: "38%"`, `maxHeight: "80%"`, `nonCapturing: true`,
  `visible: width >= 120`, toggle by `/cockpit`, refresh on `turn_end` +
  `tool_result`, ledger error surfaced as a row.

### Duck (`extensions/duck/index.ts`)

- Add `export function duckKeyAction(data: string): DuckAction | undefined` using
  `matchesKey`:
  `close` ← escape / ctrl+c / q; `lineUp` ← up / k; `lineDown` ← down / j;
  `pageUp` ← pageup; `pageDown` ← pagedown; `home` ← home / g; `end` ← end / G.
- `handleInput` dispatches `duckKeyAction(data)`; no raw byte comparisons remain.
- Render through `renderPanel`: title `duck`, `right` = `provider/model · status`
  (spinner while asking, `in N / out M` when done, `error` on failure).
- Viewport: `limit` from `min(floor(terminal.rows * 0.8) - 3, 24)` recomputed per
  render; body wrapped by `renderPanel`; footer shows
  `↑↓ scroll · PgUp/PgDn · g/G · esc close` plus `lines A–B of N`.
- **Auto-follow**: while streaming, keep the window pinned to the newest text;
  scrolling up clears follow, `end`/`G` re-enables it.
- Keep the overlay capturing (a scrollable panel needs the keyboard), and add a
  `/duck` toggle: running `/duck` while a panel is open closes it. Cockpit stays
  non-capturing — this split is the deliberate answer to locked decision #2
  (documented under rejected alternatives).

## Backend changes required

None. No ledger, config, provider, or session-format change.

## Frontend changes required

- New `extensions/shared/panel.ts`.
- Rewrite rendering in `extensions/workbench/cockpit.ts` and
  `extensions/duck/index.ts` as above.
- Update `tests/workbench/cockpit.test.ts`, `tests/duck/run.test.ts`; add
  `tests/shared/panel.test.ts`.
- Refresh `taskNotes/mods-ui-polish/taskWalkthrough.md` and the manual TUI
  checklist with the new expected visuals.

## Acceptance Criteria

1. Cockpit renders as a bordered, background-filled panel with a title bar, an
   accent section label, a context meter, provider usage rows, and decision rows;
   it stays right-anchored, non-capturing, and hidden below 120 columns, and
   `/cockpit` still toggles it.
2. Duck renders in the same panel family and responds to arrow keys, j/k,
   PgUp/PgDn, g/G, Home/End, and closes on esc/q/ctrl+c on **both** legacy and
   Kitty-protocol terminals; unit tests prove the key map for both encodings.
3. Duck's body auto-follows streaming output until the user scrolls, shows the
   visible line range, and surfaces `in/out` usage or an error in the title bar.
4. Running `/duck` while a panel is open closes it.
5. Every line returned by `renderPanel` is exactly `width` visible columns, for
   widths 40–200, with ANSI-styled and over-long content.
6. `npm run check` passes (typecheck + tests + manifest/local checks) with tests
   **new or changed in this diff** covering the key map and panel renderer.

## Validation

- `npm run check` — expect typecheck exit 0 and a `N pass, 0 fail` summary.
- `tests/duck/run.test.ts` — feed `duckKeyAction` both legacy (`\x1b[A`, `\x1b`)
  and Kitty (`\x1b[1;1A`, `\x1b[27u`) sequences and assert identical actions.
- `tests/shared/panel.test.ts` — width invariant, title/right placement, viewport
  windowing, meter boundaries.
- `tests/workbench/cockpit.test.ts` — section content, empty ledger `(none)`,
  ledger error row, rendered panel contains the frame and values.
- Print-mode smoke (must not throw):
  `pi -ne -e ./extensions/workbench/index.ts -p --no-session 'say ok'` and the
  same for `./extensions/duck/index.ts`.
- Manual TUI checklist in `taskNotes/mods-ui-polish/taskWalkthrough.md`:
  distinct panel chrome, readable on dark and light themes, cockpit hidden <120
  cols, typing still works with cockpit open, duck scrolls and closes with Esc and
  with `/duck` on a Kitty-capable terminal, duck follows the stream.

## Specs (complexity >= 3)

- `specs/specs.md` — breakdown.
- `specs/shared-panel/taskFindings.md` — the shared panel kit.
- `specs/cockpit/taskFindings.md` — cockpit rebuild.
- `specs/duck/taskFindings.md` — duck interactivity and panel.

## Out of scope

- Adding new cockpit data (e.g. live Fabric agents) — the ask is visual/UX only.
- Pet, statusline, MCP renderer, `/context`, `/report` styling.
- Any non-capturing redesign of duck beyond the documented `/duck` toggle.
