# fabric-ui-rework — frontend (TUI) validation

Run 2026-10-21 in a Herdr pane against a synthetic root with real session files.

## Layout

- Rows render below the editor and above Pi's footer; six-row cap plus `+N more agents`.
- Every row is one line: at widths 1/2/3/20/80/160 the renderer never exceeds the width
  (`tests/fabric/agents.test.ts`), and the live pane confirmed no wrapping at 66 and 104 columns.
- Full-window screens fill `terminal rows - 3` exactly; the rows widget is hidden while a screen is
  open, so nothing clips the top.

## Interaction

| Key | Screen | Result |
| --- | --- | --- |
| `↑`/`↓` | `/agents` | selection moves, clamps at both ends |
| `→` | `/agents` | expands a collapsed group/parent |
| `←` | `/agents` | collapses an expanded row |
| `Enter` | `/agents` | opens an agent or a whole group |
| `x` → `y`/`n` | `/agents` | inline cancel confirmation; a group cancels all members |
| `Esc` | `/agents` | back to the chat |
| `tab` | transcript | focus moves between the two columns |
| `s` | transcript | one column ↔ two columns |
| `pgup`/`pgdn`, `g`/`G` | transcript | scrolls only the focused column; `G` resolves against the next layout |
| `Esc` | transcript | back to `/agents` |

## Visual identity

- Child transcripts: generated hue on the name, the rule, and the message-header bands; body text
  unchanged.
- Main transcript: theme accent header/rule instead of a generated hue.
- Group columns: each column carries its own header and focus marker (`›`), separated by `│`.
- Light and dark themes are handled by choosing the generated colour's lightness from
  `theme.appearance`; the unit tests cover the token fallback.

## Known limits

- Two columns require ≥ 80 terminal columns; below that a single column is shown with an explicit
  note.
- Rows below the prompt are display-only (Pi widgets take no keyboard focus); `/agents` is the only
  way in, by design.
- An agent that expires while a transcript is open keeps rendering (the file is already loaded);
  `/agents` no longer lists it on return.
