# Purpose

Add a main-chat-only `/btw` side-chat window that answers questions from the
current chat transcript alone, never touches the main session, and can stage a
compact summary into the editor for the next main-chat message.

## Original Ask

The user's requirement, in their words:

> We need a BTW skill or prompt: That will allow me to ask any question using a
> fabric window, only from given chat. Nothing from elsewhere. And it will not
> hamper the existing chat. When I want (using a subcommand or option) I can send
> the summary to next message in main chat, It must be active from main chat and
> not any subagent.

Clarified in the follow-up exchange:

- **Window:** a side chat — `/btw` opens the window, follow-ups happen there, Esc
  closes it.
- **Context:** the full transcript — user/assistant text, tool calls, and tool
  results from the current branch; no thinking blocks.
- **Summary:** a compact answer plus the question, staged as an **editor draft**
  so the human reviews and sends it as the next main-chat message.
- **Model:** “Anything free.”
- **Summary trigger:** a key in the window **and** `/btw send` after closing.
- **Persistence:** ephemeral — no disk writes, no session entries.
- **Shape:** left to us, but it must be available here and in every session from
  now on.

Interpreted as one outcome: **A main-chat-only `/btw` full-window side chat answers
questions from the current chat transcript only, leaves the main session
untouched, and can stage a compact summary into the editor on demand.**

## Complexity and the reason behind it

**Score: 3 / 5.**

- A new extension with a custom full-window TUI, a nested model call, and a
  summary stage; no data model, migration, or new dependency.
- Two small shared helpers (full-screen state and nested-stream accumulation) and
  a coordination change in Fabric so its agent rows do not clip the BTW window.
- Verification is mostly pure unit tests for transcript serialization, model
  resolution, prompts, summary formatting, and view layout, plus a manual TUI
  checklist for the live window.

## Current-state findings

1. **There is no BTW surface.** `/duck` is the closest feature, but it generates
   questions from the latest assistant plan and presents them through
   `AskUserQuestion`; it does not answer questions, keep a side chat, or read the
   full transcript.
2. **Fabric owns full-window screens.** `extensions/fabric/index.ts` uses
   `ctx.ui.custom`, hides its `pi-fabric-agents` widget while a screen is open,
   sizes the screen to `terminal.rows - 3`, and restores the rows afterwards. A
   separate full-screen extension that does not coordinate with Fabric can be
   clipped by Fabric’s 750 ms refresh.
3. **Fabric children would not load BTW anyway**, because
   `buildChildArgs()` launches workers with `--no-extensions --extension
   <fabric entry>`. The requirement still needs an explicit main-chat guard:
   `PI_FABRIC_AGENT` is present in every worker.
4. **The active transcript is available without touching the session.**
   `ctx.sessionManager.buildSessionProjection().messages` returns the
   compaction-aware messages for the current branch, including user, assistant,
   toolResult, custom messages, and the leading system prompt.
5. **Nested model calls are already a proven pattern.** Duck calls
   `ctx.modelRegistry.streamSimple(...)` in-process, adds opencode attribution
   headers, and accumulates text/usage/errors without appending anything to the
   session. BTW can use the same mechanism with a free model.
6. **Free models are configured in this installation:** `opencode-go/beam-free`,
   `opencode-go/longcat-2.5-preview-free`, and
   `opencode-go/iceman-contributor-free`. `PI_BTW_MODEL` gives an explicit escape
   hatch.
7. **Fabric’s UI helpers are reusable but not yet shared.** `windowHeight`,
   `fitScreen`, and the screen-depth flag are local to `fabric/index.ts`; there is
   no shared full-screen lock. Moving them to `extensions/shared/` lets BTW and
   Fabric agree on when the agent rows should stay hidden.

## Architectural changes required

- New registered extension: `extensions/btw/index.ts` plus helpers under
  `extensions/btw/`.
- New shared helpers:
  - `extensions/shared/full-screen.ts` — full-window sizing, fitting, and a
    process-wide screen-depth lock used by Fabric and BTW.
  - `extensions/shared/nested.ts` — nested-stream accumulation and opencode
    attribution headers, extracted from Duck and reused by BTW.
- Fabric refactor to use the shared full-screen helpers and to check the shared
  lock in `updateAgents`.
- No new dependencies, no session format change, no settings schema.

## Backend changes required

### Transcript serialization (`extensions/btw/transcript.ts`, pure)

- Export `BtwBlock = { id: string; kind: "user" | "assistant" | "toolCall" |
  "toolResult"; text: string; toolName?: string; isError?: boolean }` and
  `BtwTranscript = { text: string; blocks: number; dropped: number; truncated: boolean }`.
- `transcriptFromMessages(messages: readonly unknown[]): BtwBlock[]`:
  - Skips `system` messages and thinking parts.
  - User messages: text parts and a `[image]` placeholder.
  - Assistant messages: text parts and `toolCall` parts
    (`[tool call: <name>] <json args>`).
  - Tool results: `[tool result: <name>]` plus text, marking failures.
  - Labels each block `[m<N>]` in order so the model can cite turns.
  - Bounds each block: 8,000 chars for text, 2,000 for tool results, 400 for tool
    arguments; append `… truncated N characters`.
- `renderTranscript(blocks, budgetChars): BtwTranscript`:
  - Iterate newest-to-oldest, adding blocks while they fit.
  - If the newest block alone exceeds the budget, keep its newest portion.
  - Reverse the kept blocks into chronological order.
  - Return `dropped` (number of omitted blocks) and `truncated` (boolean).
  - Prepend `[BTW: transcript truncated; showing the most recent N of M blocks]`
    when anything was dropped or cut.

### Model resolution (`extensions/btw/model.ts`, pure)

- `parseModelRef(text)` → `{ provider, id } | undefined`, accepting
  `provider/id` and bare ids.
- `FREE_MODEL_PREFERENCE = ["opencode-go/beam-free",
  "opencode-go/longcat-2.5-preview-free",
  "opencode-go/iceman-contributor-free"]`.
- `resolveBtwModels({ registry, current, override, scoped })` returns an ordered
  candidate list plus a source/warning:
  1. `PI_BTW_MODEL` when set and resolvable.
  2. The preference list, in order, when the model is available/authenticated.
  3. Any available model whose id contains `free`.
  4. The current session model, with a warning that no free model was found.
  5. Empty when none of the above exist.
- Availability is read from `registry.getAvailable()`; free candidates are used
  even when the session's enabled-model scope excludes them, because the request
  was explicitly "anything free". Explicit overrides use `registry.find()` plus
  `hasConfiguredAuth()`.
- Display string: `provider/id`.

### Prompt building (`extensions/btw/prompt.ts`, pure)

- `buildBtwSystemPrompt()` returns the strict contract: use only the transcript,
  cite `[mN]` labels, say when the transcript does not answer, never request
  tools, never claim outside knowledge.
- `buildBtwQuestion({ transcript, side, question })` returns a single user
  message with three delimited sections: `MAIN CHAT TRANSCRIPT` (the only allowed
  source), `BTW SIDE CHAT` (prior side Q/A, for continuity), and `QUESTION`.
- `buildSummaryPrompt(side)` returns a single user message asking for a compact
  title line and 2–5 bullets from the side chat only.
- No project context, memory, skills, file contents, or system prompt from the
  main chat is included.

### Summary staging (`extensions/btw/summary.ts`, pure)

- `formatSummaryBlock(question, body)` returns:
  `BTW: <question>` + body + `(From a BTW side chat; grounded only in the main chat.)`.
- `appendToDraft(existing, block)` preserves the current editor draft and appends
  the block with one blank line; returns the draft unchanged when it already ends
  with the same block.
- `trimAnswer(text, limit = 800)` for the short-answer shortcut.
- Summary strategy: one short answer and no follow-ups → use the answer verbatim;
  otherwise call the model with `buildSummaryPrompt`; on failure, fall back to the
  last answer trimmed.

### Nested stream helper (`extensions/shared/nested.ts`)

- Move `textOfMessage`, `usageOf`, `errorOf`, `accumulateDuck`, and
  `nestedHeaders` from `extensions/duck/index.ts` into the shared module.
- Re-export the old names from Duck so `tests/duck/run.test.ts` keeps working.
- BTW uses the same accumulator with an `AbortController` signal.

## Frontend changes required

### View (`extensions/btw/view.ts`, pure)

- `renderBtwView(input, width, height)` returns exactly `height` lines:
  - Header: `◆ BTW · side chat`, model name, and a context note
    (`grounded in this chat only`).
  - Rule: accent border.
  - Body: wrapped side-chat messages with `You` / `BTW` labels, a streaming
    caret, and a scroll window.
  - Input: the editor lines passed in by the screen.
  - Footer: `enter ask · alt+s summary · pgup/pgdn scroll · esc close` and a
    status/truncation/warning line.
- Body scrolling is offset-based; `maxOffset` is recomputed on render. PageDown /
  PageUp move by the visible page; new answers auto-follow the end unless the
  human scrolled up.
- Narrow widths wrap without exceeding the width; every line is truncated with
  `truncateToWidth`.

### Screen (`extensions/btw/screen.ts`)

- `BtwScreen` implements `Component & Focusable`, owns an `Editor` for the
  question, and reads the shared `BtwState`. It accepts an optional minimal
  editor object so key handling can be tested without a real terminal.
- Keys:
  - `Enter` asks the current question.
  - `alt+s` stages the summary and closes (only when an answer exists).
  - `Esc` closes and aborts an in-flight request.
  - `PageUp` / `PageDown` scroll the body.
  - All other keys go to the editor.
- `focused` is forwarded to the editor so IME candidate windows land correctly.
- `setHeight` + `render` fit the screen to `windowHeight(tui.terminal.rows)`.
- No timers; streaming updates call `tui.requestRender()`.

### Command and controller (`extensions/btw/index.ts`)

- Guard at registration and execution: `process.env.PI_FABRIC_AGENT` → do not
  register / notify and return.
- `ctx.mode !== "tui"` → notify that BTW needs the interactive UI.
- `/btw` and `/btw <question>` open the side chat; a supplied question is asked
  immediately.
- `/btw send` stages a summary from the last side chat held in module memory.
- On open:
  - Read `buildSessionProjection().messages`, serialize and budget the transcript.
  - Resolve the model candidates and show the chosen model/warning in the header.
  - `beginFullScreen()`, hide `pi-fabric-agents`, open `ctx.ui.custom`, and
    `endFullScreen()` in `finally` so Fabric restores its rows.
- On ask:
  - Append the question to the side chat.
  - Build the prompt, call `streamSimple` with a fresh `AbortController`,
    `sessionId`, opencode headers, and `maxTokens = min(model.maxTokens, 4096)`.
  - Append deltas live; on a pre-text error, try the next candidate; on a
    mid-stream error, stop and show the error.
  - Track usage locally only; never append to the session.
- On summary:
  - Close the window, set `ctx.ui.setStatus("btw", "summarizing…")`, generate or
    reuse the summary, and `ctx.ui.setEditorText(appendToDraft(...))`.
  - Clear the status in `finally`; notify when no answer exists.
  - Drop the pending side chat after staging.
- On close: keep the last side chat in module memory for `/btw send`; clear it on
  a new open, after staging, and on `session_shutdown`.

### Fabric coordination (`extensions/fabric/index.ts`, `extensions/shared/full-screen.ts`)

- Move `PI_FOOTER_ROWS`, `windowHeight`, and `fitScreen` to the shared module;
  import them in Fabric instead of the local copies.
- Replace Fabric’s local `screenDepth` with the shared `beginFullScreen` /
  `endFullScreen` / `fullScreenOpen` counter.
- `updateAgents` returns early when `fullScreenOpen()` so BTW’s window is not
  clipped by a refresh; `withScreen` still hides/restores the widget.
- `FABRIC_AGENTS_WIDGET` is exported from the shared module and used by both
  extensions.

## Acceptance Criteria

1. `/btw` opens a full-window side chat in the main session; the main transcript
   is unchanged and no session entry is appended.
2. The side model sees only the serialized current-branch transcript and the side
   chat; system prompts, thinking blocks, files, memory, web, and subagents are
   excluded.
3. The prompt requires `[mN]` citations and a plain “not in the transcript” answer
   when the transcript does not contain the answer.
4. A long transcript is sent newest-first; the oldest blocks are dropped, and both
   the window and the answer show a truncation notice.
5. The model resolution prefers a free model, honors `PI_BTW_MODEL`, and falls
   back to the current model with a visible warning.
6. `alt+s` and `/btw send` both stage `BTW: <question>` + a compact answer into
   the editor, preserve an existing draft, and do not auto-send.
7. The side chat is never written to disk or the session; the last side chat lives
   only in module memory until a new window, a staged summary, or session end.
8. When `PI_FABRIC_AGENT` is set, `/btw` is not registered and the handler refuses;
   non-TUI modes notify instead of opening a window.
9. Fabric’s agent rows are hidden while the BTW window is open and restored after
   it closes; the BTW screen is not clipped.
10. `package.json` registers `./extensions/btw/index.ts`, so the globally installed
    package loads it in every future session after `/reload`.
11. `npm run check` passes with tests new or changed in this diff.

## Validation

- `npm run check` — typecheck exit 0 and a `N pass, 0 fail` summary.
- `tests/btw/transcript.test.ts` — user/assistant/tool blocks, thinking and system
  skipped, per-block bounds, newest-first truncation and notices.
- `tests/btw/model.test.ts` — override wins, free preference order, `free` id
  fallback, free outside the session scope, current-model fallback warning, no
  model case.
- `tests/btw/prompt.test.ts` — transcript is the only source, side chat is
  included, summary prompt stays inside the side chat.
- `tests/btw/summary.test.ts` — block format, draft preservation, duplicate
  avoidance, short-answer shortcut.
- `tests/btw/view.test.ts` — exact height, header/footer, wrapping, scrolling,
  streaming caret, truncation/warning lines.
- `tests/btw/screen.test.ts` — Enter asks, `alt+s` requests a summary, Esc closes,
  PageUp/PageDown scroll, editor text is forwarded.
- `tests/btw/extension.test.ts` — `/btw` registers in the main session, is skipped
  when `PI_FABRIC_AGENT` is set, and non-TUI modes notify without a custom screen.
- `tests/shared/full-screen.test.ts` — window height/fit helpers and the screen
  lock counter.
- Manual TUI checklist in `taskWalkthrough.md`: open `/btw`, ask two follow-ups,
  scroll, `alt+s`, verify the editor draft, close and `/btw send`, verify the main
  chat is unchanged, and verify Fabric rows return after closing.

## Out of scope

- Persisting BTW history or adding a `/btw history` command.
- A side chat per Fabric agent or any subagent support.
- Tool use, file reads, web access, or memory reads inside BTW.
- Auto-sending the summary or injecting it as a hidden custom message.
- A new skill that adds system-prompt tokens; the command is documented in
  `docs/btw.md`.
- Changing the main chat’s model, context, compaction, or usage accounting.
