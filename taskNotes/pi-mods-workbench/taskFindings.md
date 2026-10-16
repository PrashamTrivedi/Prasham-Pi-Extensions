# Purpose

Ship **Increment 4 (workbench + session observability)** *and* **Increment 4b
(duck)** of `docs/pi-mods-plan-2.md`: the visible Pi customisations — animated
**pet**, a rewritten **statusline** footer, a right-anchored **cockpit** overlay,
session observability (MCP renderer, `/context`, `/report`), and **`/duck`** —
all loadable and testable from this directory.

## Original Ask

User's words (verbatim from the session):

> "I haven't seen anything about cockpit, pet or any other things apart from
> usage. Are they being developed or dropped?"
> "Increment 4. Including duck..."
> "g with everything."  *(approval intent — awaiting the gate's literal `g`)*
> "g: Everything should be implemented."  *(approval intent; the gate needs a bare `g` or `/dev-approve`)*

**Scope is everything:** all four specs (A pet+statusline, B cockpit, C
observability, D duck) are in scope. Nothing in increment 4 or duck is deferred or
simplified away.

Scoped outcome for this run — **Increment 4 as written in
`docs/pi-mods-plan-2.md` §4, plus duck (4b)**:

1. `extensions/workbench/` — one registered entry, feature-flagged by
   `workbench.config.json` (`pet`, `statusline`, `cockpit`), each feature in its
   own `try` so one failure cannot take the others down (locked decision #6).
2. **pet** — animated working indicator + per-turn themed verbs + `/pet` command.
3. **statusline** — rewrite as a two-line footer (branch · context · duration ·
   cost; provider usage) using `setFooter`, restored on shutdown.
4. **cockpit** — right-anchored, non-capturing overlay showing context %, cost,
   provider usage windows, and recent Jev decisions (via `shared/ledger.ts`).
5. **Observability (I4.1–I4.3)** — MCP/Jaal tool renderer, `/context` budget
   breakdown, session ledger write side + `/report`.
6. `extensions/duck/` — `/duck <prompt>`: plan → questions-only second opinion via
   `ctx.modelRegistry.streamSimple`, nested-call usage in the header.
7. Register both entries in `pi.extensions`; keep everything already shipped
   (`usage`, `cloudflare-ai-usage`, fabric, …) — **drop nothing**.
8. **Fail visibly** (user directive): a missing ledger server, missing model, or
   provider failure is shown, not silently swallowed.

## Verified API surface (installed 1.2.0)

| Capability | Verified declaration |
|---|---|
| pet indicator | `setWorkingIndicator({ frames?: string[]; intervalMs?: number })`, `setWorkingMessage(message?)`, `setStatus(key, text?)` |
| statusline | `setFooter(factory)` with `ReadonlyFooterDataProvider` = `getGitBranch`, `getExtensionStatuses`, `getAvailableProviderCount`, `onBranchChange`; restore with `undefined` |
| context/cost | `getContextUsage(): { tokens: number \| null; contextWindow: number; percent: number \| null }`; token/cost from `ctx.sessionManager.getEntries()` |
| cockpit overlay | `custom(factory, { overlay: true, overlayOptions })`; `OverlayOptions` = `width?: SizeValue`, `maxHeight?: SizeValue`, `anchor?: OverlayAnchor`, `visible?: (w,h)=>boolean`, `nonCapturing?: boolean` |
| MCP renderer (I4.1) | `registerToolRenderer((toolName, next) => ToolRenderers \| undefined)` |
| branch state (I4.3) | `registerEntryRenderer(customType, renderer)`; `appendEntry` |
| duck | `ctx.modelRegistry.streamSimple(model, context, options?)` (returns an event stream) |
| entry registration | `registerCommand(name, { description, handler })`; `pi.extensions` + `check-package.mjs` default-export check |

## Locked decisions carried

- One `workbench` entry with feature flags; failures isolated per feature.
- No `bun:sqlite`/`node:sqlite` in the Node graph; ledger via `shared/ledger.ts`.
- No `as any` / `as unknown as`; no `child_process` / `pi.exec`.
- `ctx.mode !== "tui"` guarded wherever UI is called.
- No network in tests (injected `fetchImpl` / fake streams).

## Blockers / decisions to settle in this increment

1. **Ledger-server lifecycle vs. the no-`child_process` rule.** `plan-2` I4 lists
   auto-start/health/shutdown, but the definition of done forbids `child_process`
   and `pi.exec`. **Decision proposed:** the extension **does not spawn** the
   server. It health-checks `PI_JEV_LEDGER_URL`; the cockpit shows
   `ledger server not running — bun run extensions/shared/ledger-server.ts` when
   absent. Start/stop stays manual (documented in the walkthrough). Auto-start is
   **deferred**, not dropped, and would require explicitly relaxing the DoD.
2. **`nonCapturing` overlays may not hold input while typing** (plan-2 §6). Fall
   back to `setWidget` if the manual run shows it steals focus.
3. **Per-turn token/cost aggregate is still unresolved.** Cost is a running sum
   computed from assistant-message usage.

## Complexity and the reason behind it

**Complexity: 5 / 5.**

- Four independent surfaces (pet, statusline, cockpit, duck) plus three
  observability features, across two new extension entries.
- Most rendering is **manual-check-only** in TUI mode.
- Cross-cutting state (context, cost, usage, ledger, branch) feeds three displays.
- Two live features depend on an externally started server and a model stream.

## Architectural changes required

- `extensions/workbench/` (entry `index.ts`) + `extensions/duck/` (entry).
- `workbench.config.json`: `{ pet: {...}, statusline: {...}, cockpit: {...},
  observability: {...} }` via `shared/config.ts`.
- Shared display primitives reused by statusline and cockpit: `stats.ts`
  (duration/cost/token helpers), `usage.ts` already exists in `shared/`.
- Session ledger: append-only JSONL (`~/.pi/agent/state/session.jsonl`) via Node
  `fs`; `/report` reads it. Two read-only endpoints added to the existing
  `ledger-server.ts` (one server, one client, per decision #7).

## Backend changes required

- `extensions/workbench/index.ts` — config load; register each feature in its own
  `try`; report one failure per feature via `notify`.
- `extensions/workbench/pet.ts` — `verbs.ts` (themed lists: starwars/marvel/barca/
  auto), per-turn rotation, `/pet` (`show`, `theme <t>`, `badges`), restore
  defaults on shutdown. Pure `pickVerb`/`moodFrom` tested.
- `extensions/workbench/statusline.ts` — two-line footer; `stats()`/`duration()`
  pure and tested; `footer.getGitBranch()` + `onBranchChange()`.
- `extensions/workbench/cockpit.ts` — overlay via `custom`; recompute on
  `turn_end` + `tool_result`; sections: context, cost, usage, Jev decisions.
- `extensions/workbench/mcp-renderer.ts` (I4.1) — `registerToolRenderer` for
  `mcp__*` names; `next() ?? mine` fall-through.
- `extensions/workbench/context.ts` (I4.2) — `/context` breakdown (project tree,
  nested AGENTS.md by file, skills, MCP schemas) derived from `getContextUsage`
  plus the known injectors' limits.
- `extensions/workbench/report.ts` (I4.3) — session ledger write on
  `tool_execution_start/end`, `message_end`, and fabric spawn/cancel; `/report`.
- `extensions/duck/index.ts` — `buildDuckPrompt(plan, question)` pure + tested;
  nested call via `streamSimple`; render header with nested `usage.input/output`.
- `package.json` — add `./extensions/workbench/index.ts` and
  `./extensions/duck/index.ts`.
- Tests: `tests/workbench/{pet,statusline,context,report}.test.ts`,
  `tests/duck/duck.test.ts`.

## Frontend changes required

- pet animated indicator + themed working message.
- statusline two-line footer.
- cockpit right overlay.
- `/duck` overlay/widget.
- `/context`, `/report`, `/pet` notifications.
- **Manual TUI checklist** (written, not automated): indicator animation, footer
  repaint on branch change, overlay placement, overlay hidden < 120 cols, widget
  placement, theme switch, regular vs fullscreen, duck widget.

## Acceptance Criteria

For complexity >= 3, explicit criteria:

1. `pi -ne -e ./extensions/workbench/index.ts` and `.../duck/index.ts` load without
   error; commands `/pet`, `/context`, `/report`, `/duck` exist.
2. With all `workbench` features `false`, the extension loads and does nothing.
3. One feature throwing does not prevent the others (per-feature `try` + one
   `notify`).
4. `pickVerb` rotates per turn across themes; `moodFrom` and `stats()`/`duration()`
   are pure and tested.
5. statusline restores the built-in footer on `session_shutdown`; cockpit hides
   below 120 columns.
6. `/context` reports the known injector limits (8,000 / 200,000) and current
   `getContextUsage()` without fabricating numbers.
7. `/report` reads the session ledger; the ledger is append-only and excluded from
   model context; a missing ledger server shows a visible message, not an error.
8. `/duck` returns **questions only**; the header shows nested `input`/`output`
   usage; a failing nested call is shown visibly.
9. In `print`/non-UI mode nothing throws and no `ctx.ui.*` call is made.
10. `npm run check` exits 0 (typecheck, 0 failures, manifest) with new/changed
    tests covering 3–8.
11. Nothing removed: existing entries (incl. `usage`, `cloudflare-ai-usage`) stay.
12. No `bun:sqlite`/`node:sqlite` in extension graphs; no `as any`/
    `as unknown as`; no `child_process`/`pi.exec`.

## Validation

```sh
npm run check
pi -ne -e ./extensions/workbench/index.ts     # /pet /context /report, footer, overlay
pi -ne -e ./extensions/duck/index.ts          # /duck <prompt>
# manual ledger: bun run extensions/shared/ledger-server.ts, then open the cockpit
pi -ne -e ./extensions/workbench/index.ts -p --no-session 'say ok'   # print-mode smoke
```

Manual TUI checklist in the walkthrough.

## Specs

- `specs/spec-a-pet-statusline/taskFindings.md`
- `specs/spec-b-cockpit/taskFindings.md`
- `specs/spec-c-observability/taskFindings.md`
- `specs/spec-d-duck/taskFindings.md`

## Nothing is dropped — roadmap

| Feature | Increment | Status |
|---|---|---|
| Foundation, opencode-go `usage` | 1, 3 | **built, pushed** |
| pet, statusline, cockpit, I4.1–I4.3 | **4** | **this plan** |
| **duck** | **4b** | **this plan** |
| `/skills doctor` | 2 | planned |
| jev native adapter + `decorate` | 5 | planned |
| model router / MCP exposure / nested classification / provider interception / `/handoff` | 6 | planned |
| fabric forensics + `/team gc`, herdr parity | 7 | planned |
| gate, ramp | — | deferred by decision |
