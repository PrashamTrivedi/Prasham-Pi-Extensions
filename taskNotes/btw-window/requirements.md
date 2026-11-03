# btw-window — requirements

## Goal

A human-invoked, main-chat-only side window (`/btw`) that answers questions using
only the current chat transcript, leaves the main session untouched, and can stage
a compact summary into the editor for the next main-chat message.

## Who and why

Prasham, while working in Pi. He wants to ask “by the way” questions about the
current conversation without derailing the main agent, polluting its context, or
delegating to a subagent.

## Requirements

1. `/btw` opens a full-window side chat in the Fabric visual language. The main
   chat is not replaced and receives no transcript entries.
2. Answers use only the current session’s active transcript: user/assistant text,
   tool calls, and tool results from the current branch. No thinking blocks, no
   files, no web, no memory, no skills, no external facts, and no subagent.
3. The answering model is a free model by default. `PI_BTW_MODEL` may override it.
   If no free model is authenticated, fall back to the current model with a visible
   warning in the window.
4. The transcript is sent newest-first. When it exceeds the model window, drop the
   oldest messages and show a truncation notice in the window and answer.
5. Follow-up questions are asked in the same window. The side chat keeps its own
   local history; it is never added to the main session.
6. `alt+s` in the window, or `/btw send` after closing, stages a compact summary
   into the editor. The summary starts with `BTW: <question>`, contains the key
   answer, and notes that it came from a side chat. Existing editor text is
   preserved; nothing is auto-sent.
7. The side chat is ephemeral: no disk writes, no session entries, no context
   changes. The last side chat is held in memory only so `/btw send` works after
   closing; opening a new BTW window, staging its summary, or ending the session
   discards it.
8. Only the main chat may use it. When `PI_FABRIC_AGENT` is set, do not register or
   run `/btw`. Non-TUI modes notify instead of opening a window.
9. It must be available in this repository and in every future session: register it
   in `package.json` → `pi.extensions`; the globally installed package then loads it
   after `/reload`.
10. The window must not be clipped by Fabric’s agent rows: coordinate full-screen
    state so Fabric hides its widget while BTW is open and restores it afterwards.

## Non-goals

- A subagent or Fabric child. BTW is an in-process nested model call, never
  delegated.
- Persisting side chats to disk or into the session.
- Editing files, running tools, or fetching external data from BTW.
- Auto-sending the summary.
- Replacing the main chat or changing its model or context.
- A skill that injects more system-prompt text; the feature is a command plus a
  window, documented in `docs/btw.md`.

## Open questions

None. The model is resolved at runtime; when no free model is available, BTW warns
and uses the current model.
