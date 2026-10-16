# Triage report — mods UI defects

Scope: `/root/Code/Projects/Prasham-Pi-Extensions`, extensions `workbench`
(cockpit) and `duck`. Start commit `e064dc6`.

---

## Defect 1 — overlays read as "CLI in CLI"

**Symptom (user):** no visual distinction between the main content area and the
cockpit/duck overlays.

**Affected paths**

- `extensions/workbench/cockpit.ts` → `buildCockpitLines()`, and the `render`
  callback inside `ctx.ui.custom` (`latest.map(line => truncateToWidth(line, width))`).
- `extensions/duck/index.ts` → `buildPanelLines()`, same truncate-only render.

**Root cause**

Both overlays emit plain text rows: no border, title, background, section labels,
or padding. `truncateToWidth` is the only styling applied, so the overlay content
is indistinguishable from ordinary transcript output. There is no shared visual
language between the two panels, and no background to separate them from
whatever is behind them.

**Reproduction**

Open `/cockpit` or `/duck` in a TUI session on any width ≥ the `visible()`
threshold; the panel occupies the right rail as unadorned text with no frame.

**Proposed fix**

Introduce `extensions/shared/panel.ts` and render both overlays through it:
rounded frame (`borderAccent`/`borderMuted`), `accent` title, `muted` right label,
`toolPendingBg` background fill on every row, section labels, a context meter for
cockpit, and a dim footer hint. Every line must be exactly `width` columns using
`truncateToWidth` + `visibleWidth` for ANSI-aware padding.

---

## Defect 2 — duck is unusable; input does nothing

**Symptom (user):** when the duck panel shows its questions, nothing can be
interacted with.

**Affected path**

- `extensions/duck/index.ts` → `handleInput` inside `ctx.ui.custom`.

**Root cause**

The handler matches raw terminal byte strings:

```ts
if (data === "\u001b" || data === "q") { ... }
else if (data === "\u001b[A" || data === "k") { ... }
else if (data === "\u001b[B" || data === "j") { ... }
else if (data === "\u001b[5~") { ... }   // PgUp
else if (data === "\u001b[6~") { ... }   // PgDn
```

Pi negotiates the **Kitty keyboard protocol** with supporting terminals:

- `pi-tui/dist/terminal.js` — `DESIRED_KITTY_KEYBOARD_PROTOCOL_FLAGS = 7`
  (disambiguate escape codes + report event types + report alternate keys).
- `pi-tui/dist/terminal.js` — `queryAndEnableKittyProtocol()`; on a
  `kitty-flags` reply with non-zero flags it calls `setKittyProtocolActive(true)`.

Under that protocol the arrows, PgUp/PgDn, Home/End and Escape arrive as CSI-u
sequences, e.g. `\x1b[1;1A`, `\x1b[5~` may arrive as `\x1b[57362u`, Escape as
`\x1b[27u`. None of the raw comparisons above match, so:

- arrows, PgUp, PgDn, Escape do **nothing**;
- only the printable single-character fallbacks (`j`, `k`, `g`, `G`, `q`) work.

Because the overlay is capturing (no `nonCapturing` option), the editor does not
receive input either. The result is a panel that looks frozen. On terminals
without Kitty support the same code mostly works, which is why this was not
caught in the original manual pass.

`matchesKey(data, "up")` in `pi-tui/dist/keys.js` already handles both encodings
(`matchesLegacySequence(...) || matchesKittySequence(...)`), so the fix is to stop
parsing raw bytes.

**Reproduction (headless-provable)**

`duckKeyAction("\x1b[1;1A")` (Kitty up) currently yields nothing; with
`matchesKey` it must yield `"lineUp"`. Same for `\x1b` vs `\x1b[27u` (close).

**Proposed fix**

Add a pure `duckKeyAction(data)` built on `matchesKey`, cover both legacy and
Kitty sequences in tests, and render a visible footer with the key hints so the
interaction is discoverable. Add a `/duck` toggle to close an open panel as a
keyboard-independent escape hatch.

---

## Defect 3 — cockpit visual/UX quality

**Affected path:** `extensions/workbench/cockpit.ts`.

**Findings**

- Flat `label value` text with manual alignment (`"context  62%"`), no sections or
  separators; usage and decisions have no hierarchy.
- No context meter; a percentage alone is hard to scan.
- No footer affordance telling the user how to hide the panel or when it refreshes.

**Proposed fix:** section model (`buildCockpitSections`) rendered through the
shared panel kit — meter for context, labeled usage rows, bulleted decisions, and a
dim footer (`/cockpit to hide · refreshes each turn`).

---

## Blast radius

- No config, ledger, provider, manifest, or session-format changes.
- Cockpit's refresh/toggle lifecycle and duck's stream/accumulation logic are
  unchanged; only presentation and duck's input mapping change.
- Existing tests that assert the old plain strings (`buildCockpitLines`,
  `buildPanelLines`) are updated in the same diff.
