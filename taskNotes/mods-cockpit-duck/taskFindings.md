# Purpose

Refine the two mods overlays: cap `/duck` at five questions and make the cockpit
show provider usage **and** stop covering the transcript.

## Original Ask

The user's requirements, in their words:

> "Duck: Limit to max 4-5 questions. Cockpit usage can be better and should not
> block the UI"

Clarified in the follow-up exchange:

> "Cockpit is mostly 2." — the complaint is screen space: the cockpit overlay
> covers the transcript; typing itself still works.
>
> "when I told you usage. I told you to show the usage in cockpit" — the provider
> usage belongs in the cockpit; it is currently a flat, often-empty line.

Interpreted as one outcome: **duck returns at most five questions, and the
cockpit shows real per-window usage from the corner without covering the
transcript.**

## Feedback log (not scope)

Deliberately outside `Original Ask` so the gate's outcome anchor never picks up
review chatter.

- Revision 2: the human replied with the bare token `g`, which the gate did not
  consume as approval (only a chat reply consumed by the gate approves). Folded
  here as **approval intent, plan unchanged**: no scope edits were carried by it.
  The two clarifications that shaped revision 1 remain the live feedback:
  "Cockpit is mostly 2." (occlusion) and "show the usage in cockpit".
- Revision 4: the bare `g` was sent a third time and still was not consumed as
  approval. Folded as **approval intent, plan unchanged**. This is the final
  automatic re-request: the chat `g` path is not reaching the gate in this
  session, so further repeats add no information. The explicit human-only command
  `/dev-approve mods-cockpit-duck` (or `/dev-status` to inspect state, `/dev-reset`
  if stale) is required to proceed. No scope change is implied.

## Complexity and the reason behind it

**Score: 2 / 5.**

- Small, well-understood refinements to two already-shipped extensions; no new
  architecture, no data model, no dependency.
- One new pure helper each for question capping and reset formatting; everything
  else is layout values plus prompt wording.
- Verification is unit tests plus the manual TUI checklist; the occlusion fix is
  inherently visual.

## Root-cause findings

1. **Duck can return an unbounded number of questions.** `buildDuckPrompt` orders
   questions by importance but never caps the count, and the panel renders whatever
   the model returns.
2. **Cockpit covers the transcript.** The overlay is `anchor: "right-center"`,
   `width: "38%"`, `maxHeight: "80%"`, so it floats in the middle-right of the
   screen over several transcript lines. It is non-capturing, so input is fine —
   this is pure occlusion.
3. **Cockpit usage is under-served.** `CockpitInput.usageText` is a single
   `formatUsage(...)` string produced only when the active provider is
   `opencode-go`; per-window percentages, reset times, and token/spend figures are
   never shown, and a non-opencode provider shows `(unavailable)`.

## Architectural changes required

None. No new files beyond tests; `shared/panel.ts` already provides the frame and
`meter`, and `shared/usage.ts` already defines `UsageWindow` / `ProviderUsage`.

## Backend changes required

None.

## Frontend changes required

### Duck — cap at five questions (`extensions/duck/prompt.ts`, `extensions/duck/index.ts`)

- `buildDuckPrompt`: replace the ordering line with an explicit cap —
  `"Return at most 5 questions (4-5 unless fewer are needed), most important first."`
- New pure `capDuckQuestions(text, max = 5): { text: string; omitted: number }`:
  - treat a line as a question when its trimmed form starts with a list marker
    (`-`, `*`, `•`, `1.`, `1)`, `Q1:`) or ends with `?`;
  - if at most `max` questions, return the text unchanged;
  - otherwise keep every line up to and including the `max`-th question line and
    report `omitted` = the remaining question count;
  - if the text has no recognisable question lines, leave it unchanged (never
    mangle an unstructured answer).
- `buildDuckPanel` applies the cap and, when `omitted > 0`, appends a dim
  `…and N more questions (capped at 5)` row to the body.

### Cockpit — dock out of the way (`extensions/workbench/cockpit.ts`)

- Overlay options: `anchor: "top-right"`, `width: "32%"`, `maxHeight: "55%"`,
  `margin: { top: 1, right: 1 }`, keep `nonCapturing: true` and
  `visible: (width) => width >= 120`.
- Remove the extra blank spacer rows so the panel is shorter; the mid-screen and
  editor areas stay clear.

### Cockpit — show usage (`extensions/workbench/cockpit.ts`)

- `CockpitInput` gains `usage?: ProviderUsage` (from `shared/usage.ts`); the
  refresh path requests it for the active provider and passes the structured value
  instead of a pre-formatted string.
- New row kind `{ kind: "window"; window: UsageWindow }` emitted per window, in
  provider order (rolling → weekly → monthly).
- New pure `formatReset(resetsAt: string | undefined, now: number): string | undefined`
  returning a compact `3h` / `2d` / `now` label, or `undefined` when absent/invalid.
- Render each window as `label` + pressure `meter` + percent (+ `resets …`),
  followed by token-today / `$ MTD` when the provider reports them, then the
  `note` or `error` line. Keep `usageText` as a fallback for providers that return
  no windows.

### Cockpit — do not stall refresh

- Fetch the ledger and provider usage concurrently with `Promise.all` and add an
  in-flight guard so a burst of `tool_result` events cannot queue duplicate work;
  the previous snapshot stays rendered while a refresh runs.

## Acceptance Criteria

1. `buildDuckPrompt` instructs the model to return **at most 5** questions, most
   important first.
2. `capDuckQuestions` returns an 8-question list as its first 5 questions plus
   `omitted: 3`, returns ≤5 unchanged, and leaves unstructured text unchanged; the
   panel shows the `…and 3 more questions (capped at 5)` row when capped.
3. The cockpit overlay is anchored `top-right` with `width: "32%"`,
   `maxHeight: "55%"`, and a 1-row/1-column margin, so it no longer floats over
   mid-screen transcript lines; it stays non-capturing and hidden below 120 columns.
4. The cockpit USAGE section renders one row per reported window with label,
   meter, percent, and reset time, plus token/spend rows when present; a provider
   with no windows still shows its note or error, never a silent blank.
5. `formatReset` maps ISO timestamps to compact labels and returns `undefined` for
   missing/invalid input.
6. `npm run check` passes with tests **new or changed in this diff** for the prompt
   cap, `capDuckQuestions`, `formatReset`, and the cockpit usage rows.

## Validation

- `npm run check` — typecheck exit 0 and a `N pass, 0 fail` summary.
- `tests/duck/prompt.test.ts` — the prompt contains the 5-question cap.
- `tests/duck/run.test.ts` — `capDuckQuestions` for 3 / 8 questions and for
  unstructured prose; panel render contains the cap row.
- `tests/workbench/cockpit.test.ts` — window rows in provider order, meter and
  reset text present, note/error fallback, `formatReset` cases.
- Print-mode smoke for both extensions (must not throw).
- Manual TUI checklist in `taskWalkthrough.md`: cockpit sits in the top-right
  corner and does not cover mid-screen text; typing and other commands keep
  working; duck shows at most five questions.

## Out of scope

- Moving the cockpit to a `setWidget` dock (the user confirmed the overlay is
  wanted; only its footprint changes).
- Changes to the `usage` extension's statusline segment or refresh timer.
- Any new provider reporter beyond opencode-go.
