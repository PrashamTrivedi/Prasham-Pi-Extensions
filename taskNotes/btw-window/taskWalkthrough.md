# Walkthrough — btw-window

## Setup

Nothing to install: the extension is registered in `package.json` and the package
is already enabled in `.pi/settings.json`. In the current Pi session run `/reload`
(or restart Pi). The command list should now include `/btw`.

Optional: choose a specific model for the side chat.

```sh
export PI_BTW_MODEL=opencode-go/beam-free   # provider/model or a bare id
```

Without it, BTW tries the known free models first and only falls back to the
current model with a visible warning.

## End-to-end check (main chat)

1. Send one ordinary prompt to the main chat, for example:

   ```text
   Reply with exactly: hello
   ```

   Wait for the answer. This gives BTW a transcript to read.

2. Run:

   ```text
   /btw what did I ask you to reply with?
   ```

   Expected:
   - A full-window `◆ BTW · side chat` screen opens.
   - The header shows a free model (`opencode-go/beam-free` when available) and
     “grounded in this chat only”.
   - The answer cites the transcript block, e.g. `[m1]`.
   - The main chat is not replaced and receives no new entry.

3. Ask a follow-up in the window, for example:

   ```text
   Show me the exact words.
   ```

   Expected: the answer uses the same side chat and still cites the transcript.
   PageUp/PageDown scroll the side chat; Esc closes it.

4. Press `Alt+S` in the window.

   Expected:
   - The window closes.
   - The editor contains a draft:

     ```text
     BTW: what did I ask you to reply with?
     You asked me to reply with exactly “hello”.
     (From a BTW side chat; grounded only in the main chat.)
     ```

   - Nothing was sent; the draft is yours to edit and submit.

5. Alternative flow: press `Esc` to close the window, then run:

   ```text
   /btw send
   ```

   Expected: the same kind of draft is appended to the editor. An existing draft is
   preserved (the block is added after a blank line).

6. Confirm the main chat is untouched:

   - Scroll the main transcript: there is no BTW question/answer entry.
   - Re-run a normal main-chat prompt; the main model does not see the side chat.
   - Only if you send the editor draft does the summary become part of the next
     main-chat message.

## Model checks

- **Free model:** in a default session the BTW header should show
  `opencode-go/beam-free` (or another free model). If it shows the main model and a
  warning, no free model was available.
- **Override:** start Pi with `PI_BTW_MODEL=<provider/model>` and open `/btw`. The
  header should show that model.
- **No free model:** temporarily point `PI_BTW_MODEL` at an unavailable id; BTW
  should warn and fall back to a free model or the current model. The side chat
  still works.

## Main-chat-only check

- In a Fabric worker, `/btw` is not registered. You can approximate the guard in a
  normal process:

  ```sh
  PI_FABRIC_AGENT=worker pi --mode rpc --no-session \
    --no-extensions --extension ./extensions/btw/index.ts
  ```

  Send `{"type":"prompt","message":"/btw help"}`; the command is unknown, so no
  BTW notification appears.
- In `--mode rpc`, `--mode json`, or `--mode print`, `/btw` notifies that it needs
  the interactive TUI instead of opening a component.

## Fabric-row check

1. In a session with Fabric loaded, spawn any agent so the rows appear.
2. Open `/btw`.
3. Expected: the agent rows are hidden while the BTW window is open (the shared
   full-screen lock).
4. Close BTW with Esc or `Alt+S`.
5. Expected: Fabric’s next refresh (within ~750 ms) restores the rows.

## What to verify in the artifacts

- `frontend-validation.md` — the exact `npm run check` summary, the BTW suite
  summary, the RPC smoke output, and the live TUI transcript.
- `review-passes.md` — the review counts and the security classes checked.
- `taskFindings.md` — the outcome anchor and acceptance criteria.
