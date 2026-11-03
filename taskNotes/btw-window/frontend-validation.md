# Frontend validation — btw-window

Frontend here is the Pi TUI: the full-window side chat, its keys, and the editor
draft. Evidence below is raw output from this working tree.

## Automated

### Typecheck + full suite + package checks

Command:

```sh
npm run check
```

Result:

```text
276 pass
0 fail
1046 expect() calls
Ran 276 tests across 43 files. [1302.00ms]
Package manifest and public assets validated (13 extensions).
Local-first enablement validated (13 extensions enabled here).
exit 0
```

`npm run check` is `tsc --noEmit && bun test tests && node scripts/check-package.mjs
&& node scripts/check-local.mjs`, so the typecheck exit was part of the same green
run. The package check confirms `extensions/btw/index.ts` is registered; the
local-first check confirms the package is still enabled in `.pi/settings.json`.

### BTW-only suite

```sh
bun test tests/btw tests/shared/full-screen.test.ts
```

Result:

```text
75 pass
0 fail
167 expect() calls
Ran 75 tests across 9 files.
```

Covers transcript serialization and truncation, free-model resolution, prompt
shape, summary formatting/citations, escape stripping, exact-height/wrapping view,
key handling and scroll, the main-chat guard, non-TUI behavior, and the shared
screen lock.

### RPC smoke (not a TUI, but proves registration + non-TUI guard)

```sh
printf '%s\n' '{"id":"1","type":"prompt","message":"/btw help"}' \
  | timeout 25 pi --mode rpc --no-session --no-extensions --extension ./extensions/btw/index.ts
```

Output:

```json
{"type":"extension_ui_request","id":"...","method":"notify","message":"BTW needs the interactive TUI. Run Pi in interactive mode.","notifyType":"info"}
{"id":"1","type":"response","command":"prompt","success":true,"data":{"disposition":"handled"}}
```

The prompt was `handled` (not sent to the model), and the non-TUI guard fired.

### Global package registration smoke

Same prompt without `--extension`, so Pi loads the globally installed package
exactly as every future session will:

```sh
printf '%s\n' '{"id":"1","type":"prompt","message":"/btw help"}' \
  | timeout 40 pi --mode rpc --no-session
```

Output included:

```json
{"method":"notify","message":"BTW needs the interactive TUI. Run Pi in interactive mode.","notifyType":"info"}
{"id":"1","type":"response","command":"prompt","success":true,"data":{"disposition":"handled"}}
```

Other package extensions also loaded (`sandbox-dev`, `usage`, `pet`,
`cloudflare-ai-usage`), so this is the normal package load path, not a one-off
`--extension` load.

## Live TUI

Run in a 120×40 tmux pane:

```sh
pi --no-extensions --extension ./extensions/btw/index.ts --no-session
```

1. Sent the main-chat prompt `Reply with exactly: hello`; the main chat answered
   `hello`.
2. Sent `/btw what did I ask you to reply with?`.

Window header and answer captured from the pane:

```text
◆ BTW · side chat · opencode-go/beam-free · grounded in this chat only
────────────────────────────────────────────────────────────────────────
You
  what did I ask you to reply with?

BTW
  You asked me to reply with exactly “hello” [m1].
```

This proves the free-model preference works (`opencode-go/beam-free`, not the
main chat’s `deepseek-v4.1-flash`), the answer cites the transcript block, and the
window is dark on the main chat.

3. Pressed `Alt+S`. The window closed and the main chat showed:

```text
 BTW summary staged in the editor. Review and send it as your next message.

────────────────────────────────────────────────────────────────────────
  BTW: what did I ask you to reply with?
  You asked me to reply with exactly: hello.
  (From a BTW side chat; grounded only in the main chat.)
────────────────────────────────────────────────────────────────────────
```

The side-chat citation (`[m1]`) is kept in the window but stripped from the editor
summary, because the main chat has no mapping for `[mN]`.

`Alt+S` replaced the first draft’s `Ctrl+B`: `Ctrl+B` is tmux’s default prefix and
Pi’s editor cursor-left binding, so a tmux user could never reach BTW with it.
`Alt+S` is reachable in tmux and does not collide with an editor action.

The summary was staged, not sent. The main transcript still contained only the
original `Reply with exactly: hello` / `hello` turn; no BTW entry was appended.

4. Closed Pi and the tmux session.

## Acceptance mapping

| Criterion | Evidence |
|-----------|----------|
| 1. `/btw` opens; main transcript unchanged; no entry | Live TUI steps 2–3 |
| 2. Transcript-only source | `tests/btw/transcript.test.ts`, `tests/btw/prompt.test.ts` |
| 3. Citations + refusal contract | `tests/btw/prompt.test.ts`; live `[m1]` |
| 4. Newest-first truncation + notice | `tests/btw/transcript.test.ts` |
| 5. Free model, override, current fallback | `tests/btw/model.test.ts`; live `beam-free` |
| 6. `Alt+S` / `/btw send`, draft preserved, not auto-sent | Live TUI step 3; `tests/btw/summary.test.ts` |
| 7. Ephemeral side chat | Code: module-level `pending`, no `sendMessage`/`appendEntry`; `session_shutdown` clears it |
| 8. Main-chat-only + non-TUI | `tests/btw/extension.test.ts`; RPC smoke |
| 9. Fabric rows hidden/restored | Shared lock `tests/shared/full-screen.test.ts`; Fabric still passes its suite |
| 10. Registered for every session | `package.json` + package check; live run loaded `btw` |
| 11. `npm run check` | 276 pass, 0 fail, exit 0 |
