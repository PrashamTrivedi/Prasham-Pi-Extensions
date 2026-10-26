# btw-window — brainstorm

## Raw idea

> We need a BTW skill or prompt: That will allow me to ask any question using a fabric window, only from given chat. Nothing from elsewhere. And it will not hamper the existing chat. When I want (using a subcommand or option) I can send the summary to next message in main chat, It must be active from main chat and not any subagent.

## Initial reading (assumptions to confirm)

- A "fabric window" means the full-window custom TUI screen Fabric already uses (`ctx.ui.custom`), not a delegated Fabric child.
- "Only from given chat" means the answer is grounded in the current session transcript and nothing else: no file reads, no web, no memory, no tool execution, no subagent.
- "Will not hamper the existing chat" means no messages, entries, or context changes in the main session unless the human explicitly asks for the summary.
- "Send the summary to next message in main chat" is an opt-in action after reading the answer.
- Active only in the main session; a Fabric child (`PI_FABRIC_AGENT`) must never offer it.
