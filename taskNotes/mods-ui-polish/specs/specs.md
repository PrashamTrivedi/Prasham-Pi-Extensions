# Specs — mods-ui-polish

Breakdown of `taskNotes/mods-ui-polish/taskFindings.md` (complexity 3).
Order matters: Spec 1 lands first because Specs 2 and 3 render through it.

| # | Spec | Files | Depends on | Verify |
|---|------|-------|-----------|--------|
| 1 | Shared panel kit | `extensions/shared/panel.ts`, `tests/shared/panel.test.ts` | — | width invariant + meter unit tests |
| 2 | Cockpit panel | `extensions/workbench/cockpit.ts`, `tests/workbench/cockpit.test.ts` | Spec 1 | section + render unit tests |
| 3 | Duck interactivity + panel | `extensions/duck/index.ts`, `tests/duck/run.test.ts` | Spec 1 | key-map tests (legacy + Kitty) + render tests |

## Spec 1 — Shared panel kit

Deliverable: `renderPanel(theme, width, view)` and `meter(theme, percent, cells)`
producing a rounded, background-filled, ANSI-aware panel whose every line is
exactly `width` visible columns. `PanelTheme` is a structural interface so tests
can pass a no-op theme and production passes the real `Theme`.

Done when: unit tests assert the width invariant across widths 40–200, title and
right-label placement, body wrapping, viewport windowing + clamping, and meter
boundaries (0 / 50 / 100 / null).

## Spec 2 — Cockpit panel

Deliverable: `buildCockpitSections(input)` (pure) + `renderCockpitPanel(theme,
width, input)`, wired into the existing `/cockpit` overlay and refresh lifecycle.
Right anchor, `38%` width, `80%` maxHeight, `nonCapturing: true`, hidden below
120 columns, and the ledger error row are preserved.

Done when: unit tests cover sections for populated, empty, and ledger-error
inputs, and the rendered panel contains the frame, title, and value strings.

## Spec 3 — Duck interactivity + panel

Deliverable: `duckKeyAction(data)` built on `matchesKey`; `handleInput`
dispatches it; rendering through the shared panel kit with a streaming status
header, scroll-range footer, and auto-follow that pauses when the user scrolls;
`/duck` closes an open panel.

Done when: unit tests prove identical actions for legacy (`\x1b`, `\x1b[A`,
`\x1b[5~`) and Kitty (`\x1b[27u`, `\x1b[1;1A`, `\x1b[57362u`) encodings, and the
panel render contains the title, status, and hint rows.
