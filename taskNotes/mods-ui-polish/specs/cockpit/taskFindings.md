# Spec 2 — Cockpit panel

Parent: `taskNotes/mods-ui-polish/taskFindings.md`. Depends on Spec 1.

## Deliverable

`extensions/workbench/cockpit.ts`:

- `buildCockpitSections(input)` — pure, ANSI-free: context row + meter, usage rows,
  recent-decision rows, right label (`jev ✓` / `jev ✗` / provider), footer hint.
- `renderCockpitPanel(theme, width, input)` — composes through
  `renderPanel` from `extensions/shared/panel.ts`.

## Preserved behavior

- `/cockpit` toggle, `handle.hide()`, refresh on `turn_end` + `tool_result`.
- Overlay: `anchor "right-center"`, `width "38%"`, `maxHeight "80%"`,
  `nonCapturing: true`, `visible: width >= 120`.
- Ledger failure shown as a row, never thrown.
- `usageText` from `formatUsage`/`fetchOpencodeGoUsage` and
  `tokenTotals`/`formatTokens` unchanged.

## Layout

```
╭─ ◈ cockpit ─────────────── opencode-go/m ─╮
│                                           │
│  CONTEXT                                  │
│  ████████████░░░░░░░  62%   1.5k tok      │
│                                           │
│  USAGE                                    │
│  rolling 2% · weekly 10%                  │
│                                           │
│  RECENT DECISIONS                         │
│  • shell-safety · Bash                    │
├───────────────────────────────────────────┤
│  /cockpit to hide · refreshes each turn   │
╰───────────────────────────────────────────╯
```

## Files

- Changed: `extensions/workbench/cockpit.ts`, `tests/workbench/cockpit.test.ts`.

## Tests

- sections for populated input contain context/usage/decision strings;
- empty decisions → `(none)`; ledger error → error row;
- `renderCockpitPanel` output contains `cockpit`, the frame characters, and values.

## Done

Typecheck clean; cockpit tests pass; manual checklist item 10–12 in the walkthrough
re-verified by a human.
