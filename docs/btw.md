# BTW

A main-chat-only side chat. `/btw` opens a full-window conversation that answers
questions from **the current chat transcript alone** and leaves the main session
untouched. When you want, it stages a compact summary in the editor for your next
main-chat message.

BTW is for “by the way” questions — “what did we decide?”, “where is that
function?”, “what is still unverified?” — without derailing the main agent,
polluting its context, or waiting for a subagent.

## Commands

| Command | Purpose |
| --- | --- |
| `/btw` | Open the side chat. Ask follow-ups in the window. |
| `/btw <question>` | Open the side chat and ask that question immediately. |
| `/btw send` | Stage a summary of the last side chat in the editor. Works after you close the window. `/btw summary` is an alias. |
| `/btw help` | Show the key/command reminder. |

Inside the window:

| Key | Action |
| --- | --- |
| `Enter` | Ask the current question. |
| `Alt+S` | Stage a compact summary in the editor and close. |
| `PageUp` / `PageDown` | Scroll the side chat. New answers follow the end unless you scrolled up. |
| `Esc` | Close the window. An in-flight answer is cancelled. |

## What BTW can read

Only the active branch of the current session:

- user and assistant text,
- tool calls and tool results,
- the session’s compaction summary, if one exists.

It deliberately excludes:

- system prompts,
- hidden thinking blocks,
- files, the web, memory, skills, MCP servers, and other sessions,
- any subagent or Fabric worker.

Every transcript block is labelled `[m1]`, `[m2]`, … and the prompt requires the
model to cite the blocks it used. If the answer is not in the chat, it should say
“Not in this chat” rather than reaching for outside knowledge.

The transcript is sent newest-first. When it does not fit the model window, the
oldest blocks are dropped and the window and the answer show a truncation notice.
Individual text blocks are capped at 8,000 characters, tool results at 2,000, and
tool arguments at 400.

## Model

BTW is a side chat, not the main agent, so it prefers a free model:

1. `PI_BTW_MODEL`, when set — `provider/model` or a bare model id.
2. `opencode-go/beam-free`
3. `opencode-go/longcat-2.5-preview-free`
4. `opencode-go/iceman-contributor-free`
5. any available model whose id contains `free`
6. the current session model, with a visible warning.

If a free model fails before producing text, BTW tries the next candidate. Known
free models are used even when the session's enabled-model scope excludes them;
the scope still governs the main model selector. The nested request does not
change the session model and its usage is not appended to the session transcript.

## Summary to the editor

`Alt+S` in the window, or `/btw send` after closing, stages a draft like:

```text
BTW: What changed in the parser?
- It now skips thinking blocks.
- The transcript budget is the only new risk.
(From a BTW side chat; grounded only in the main chat.)
```

A one-question/one-short-answer side chat reuses the answer verbatim; a longer
side chat gets one compact summary call. If that call fails, the last answer is
trimmed as a fallback. The block is appended to the editor and **never sent
automatically**; an existing draft is preserved.

## Ephemeral by design

BTW writes nothing to disk and appends nothing to the session. The only retained
state is the last side chat held in module memory so `/btw send` works after you
close the window. It is discarded when you open a new BTW window, when its summary
is staged, or when the session ends.

Because no session entry is created, BTW questions and answers do not appear in the
main transcript, do not enter the main model’s context, and are not part of the
session’s usage accounting.

## Privacy and trust

The transcript BTW sends can contain source code, tool output, credentials that
appeared in a command, and anything else the main chat has seen. BTW does not
redact it. The request goes to the selected model provider — by default a free
model — so use BTW only with providers you are willing to show that chat to.

Answers are grounded by the prompt, not by a formal verifier. The prompt requires
citations and permits “Not in this chat”, but the model can still be wrong. The
summary is staged in the editor as a draft; review it before sending, which is also
why BTW never auto-sends.

Terminal escape sequences and control bytes are stripped from transcript text and
from the window, so tool output cannot repaint the terminal through BTW.

## Main chat only

BTW is intentionally unavailable in a Fabric worker: when `PI_FABRIC_AGENT` is set,
the extension does not register the command and the handler refuses. Outside the
interactive TUI (`print`, `json`, or RPC without a custom component), `/btw`
notifies instead of opening a window.

## Fabric coordination

Fabric’s agent rows are a widget beside Pi’s interactive area, so they would clip a
full-window screen. BTW takes the shared full-screen lock and hides the
`pi-fabric-agents` widget while it is open. Fabric’s next refresh restores the rows
after the window closes.

## Troubleshooting

- **“No free model is configured”** — no free candidate is authenticated or in
  scope. Set `PI_BTW_MODEL` or enable a free model. BTW still works with the current
  model, but says so in the header.
- **“Not in this chat”** — the answer is not in the transcript BTW was allowed to
  read. It will not fetch a file or search the web.
- **“Transcript truncated”** — the chat is larger than the model window; only the
  newest blocks were sent. Close and reopen BTW if the main chat has advanced.
- **“BTW needs at least one message”** — the active branch has no user/assistant
  conversation yet.
- **The window is clipped** — another extension is holding the full-screen lock or
  a widget is still visible. Reload Pi and reopen `/btw`.
