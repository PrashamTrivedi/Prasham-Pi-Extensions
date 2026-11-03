# Review passes — btw-window

| Pass | Findings | Fixed | Notes |
|------|----------|-------|-------|
| 1 | 9 | 9 | Deep read of the full diff: free-model scope, fallback warning, budget tail, lock leak, ANSI hygiene, citation leakage, dead state, abort race, tmux key conflict |
| 2 | 0 | 0 | Re-read after fixes; tests green; stopped at zero |

## Pass 1 findings

1. **Free models were blocked by the session scope.** `resolveBtwModels` preferred
   `ctx.scopedModels`, so `beam-free` (not in `enabledModels`) was skipped and BTW
   silently used the current paid model — exactly the opposite of “anything free”.
   Fixed: free candidates come from `registry.getAvailable()` and are used even
   when the enabled-model scope excludes them; the scope still governs the main
   model selector. Documented in `docs/btw.md`.
2. **A free override produced a false “no free model” warning.** `freeFound` was
   computed by list growth, so an override that was already in the free list was
   deduplicated and counted as absent. Fixed by checking the resolved ids for
   `free`.
3. **Transcript truncation had a 500-character floor and an off-by-one `dropped`.**
   A small budget could never take the single-block tail path, and the tail path
   counted the kept tail as dropped. Fixed: the floor is 20 characters and the tail
   case reports only the older blocks as dropped.
4. **The full-screen lock could leak.** `beginFullScreen()` ran before
   `setWidget()` but outside the `try`, so a widget failure would leave the lock
   held forever and hide Fabric’s rows. Fixed in both Fabric and BTW by moving the
   widget call inside `try`/`finally`.
5. **Terminal escape sequences could reach the window and the prompt.** Chat text
   and tool output are not trusted; CSI/OSC/control bytes could repaint the
   terminal through BTW. Fixed with `stripControls` in transcript bounding, prompt
   side-chat rendering, and the view; tested.
6. **Side-chat citations leaked into the editor summary.** The main chat has no
   mapping for `[mN]`, so the compact summary now strips them
   (`stripCitations`), while the window keeps citations for grounding.
7. **Dead `PendingBtw.notice` state.** Removed; the notice is derived per question
   and does not need to persist with the pending side chat.
8. **No visible warning when free candidates existed but all failed.** BTW could
   fall back to the current model with only the header model name changing. Added a
   notice when the successful model is not free, no override was set, and no
   initial warning already explains it.
9. **The first summary key, `Ctrl+B`, was unreachable under tmux and shadowed
   cursor-left.** `Ctrl+B` is tmux’s default prefix and Pi’s editor cursor-left
   binding. Switched to `Alt+S` and reran the live TUI check; the footer, help text,
   tests, and docs now say `Alt+S`.

## Pass 2

Zero findings. Re-read the diff after the fixes, ran the full suite, and checked the
live TUI path again (free model `opencode-go/beam-free`, `[m1]` citation in the
window, `Alt+S` → editor draft with citations stripped).

## Security review

- **Auth/authorization:** no auth changes; `/btw` is main-chat-only (`PI_FABRIC_AGENT`
  guard); the nested call has no tools and cannot write files or run commands.
- **Credentials/secrets:** the chat transcript — including any secret that appeared
  in it — is sent to the selected model. BTW does not redact; this is disclosed in
  `docs/btw.md` under Privacy and trust.
- **Injection:** no shell, `eval`, SQL, or dynamic code execution. Prompt injection
  from tool output can only affect generated text, which is shown in a window or
  staged as an editable draft; nothing is auto-sent.
- **Unsafe deserialization:** no untrusted JSON parsing. Session messages are read
  from Pi’s own projection; model refs are plain string parsing.
- **HTML/DOM:** no HTML or browser surface; TUI only. ANSI/control sequences are
  stripped before rendering.
- **Network:** only the model provider request; no additional network calls.
