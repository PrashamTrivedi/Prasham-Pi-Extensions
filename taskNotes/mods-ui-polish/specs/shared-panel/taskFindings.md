# Spec 1 — Shared panel kit

Parent: `taskNotes/mods-ui-polish/taskFindings.md`.

## Deliverable

`extensions/shared/panel.ts`:

- `PanelTheme` (structural: `fg` + `bg`), `PANEL_BG = "toolPendingBg"`.
- `renderPanel(theme, width, { title, right?, body, footer?, offset?, limit? })`
  → `{ lines, offset, limit, total }`.
- `meter(theme, percent | null, cells)`.

## Behavior

- `inner = width - 2`; every returned line is exactly `width` visible columns.
- Top `╭─ title ─── right ─╮` (`accent` title, `muted` right, `borderAccent` rules).
- Body rows `│ … │` (`borderMuted` bars), content wrapped to `inner` with
  `wrapTextWithAnsi`, truncated with `truncateToWidth(…, "…", true)` and padded via
  `visibleWidth`; the row is wrapped in `theme.bg(PANEL_BG, …)`.
- `offset` clamps to `[0, max(0, total - limit)]`; when `limit` is set the body is
  padded to exactly `limit` rows for a stable frame.
- Footer separator + dim row + rounded bottom.
- `meter`: `success` < 50, `warning` < 80, else `error`; `?` for null percent.

## Files

- New: `extensions/shared/panel.ts`, `tests/shared/panel.test.ts`.

## Tests

- width invariant for widths 40, 80, 120, 200 with ANSI content and long words.
- title + right label text present in line 0.
- viewport: `total` = wrapped row count, returned body rows match the window.
- meter: 0 → all empty, 100 → all filled, null → `?`.

## Done

Typecheck clean; all panel tests pass.
