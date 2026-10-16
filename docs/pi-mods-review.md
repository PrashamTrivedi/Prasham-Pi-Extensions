# Pi mods — review and recommendations

Written 2026-10-15. Four subagents ran in isolated git worktrees; every claim below was
re-verified by hand after they finished, and the verification is stated inline.

**Repo:** `Prasham-Pi-Extensions` · **Worktrees:** `/tmp/pi-mods-lab/{tui,jev,gate,pack}`
on branches `mods/{tui,jev,gate,pack}` · **Nothing merged.**

---

## 0. Status: verified

| Check | Result |
|---|---|
| `devDependencies` bumped `0.85.1 → 1.2.0` (`pi-coding-agent`, `pi-tui`) | done, `npm install` clean |
| `npm run check` on the main repo after the bump | **pass** — 12 tests, 0 fail, manifest+assets validated |
| All four worktrees typecheck against real 1.2.0 types | **pass** (4/4, `tsc --noEmit` exit 0) |
| All four worktrees' test suites on 1.2.0 | **pass** — 17 + 13 + 15 + 14 = **59 tests, 0 fail** |
| The `as unknown as` cast in `duck` removed and retypechecked | **passes without it** — it was purely the version pin |

**The bump was the highest-value action and it is now confirmed.** Every 0.85.1 workaround
the agents reached for is gone. Repo `package.json` change is uncommitted.

---

## 1. The jev-harness Pi adapter, explained

### Why the port is small

The harness was already built agent-neutral. Decisions live once in `decisions/` (13 files,
~877 lines); the engine is shared; each agent gets a thin adapter. The neutral model:

```ts
HookEvent { agent: AgentId, kind: EventKind, sessionId, cwd, tool?, lastAssistantText?, reentry? }
Verdict = none | ask | deny | rewrite | context | replace_output | continue | notify
```

`runEvent(e, DECISIONS, { supports })` runs applicable decisions in parallel, applies `mode`
(off/shadow/enforce) and the `safety` fail policy, logs to the ledger, returns verdicts.
`merge()` folds many verdicts into one payload with defined precedence: **strongest gate wins,
a gate makes a rewrite moot**, context and notices concatenate.

So porting to Pi is **a fourth adapter plus one union member** — `AgentId` gains `"pi"` in
`core/types.ts`. `decisions/`, `core/engine.ts`, `merge()`, the ledger: all untouched. The
Claude adapter is 94 lines; a Pi one is comparable. That is the whole cost.

Confirmed by the agent's implementation: it labels events `agent: "claude-code"` precisely
because `AgentId` has no `"pi"` member yet.

### Verdict → Pi mapping

| Verdict | Claude Code | Pi |
|---|---|---|
| `deny` | `permissionDecision: "deny"` (PreToolUse only) | `tool_call` → `{block: true, reason}` |
| `ask` | `permissionDecision: "ask"` — a **return value** | **no ask return value.** The handler must ask (`ctx.ui.confirm`), then return `{block}` or nothing |
| `rewrite` | `updatedInput`; permission rules still run | mutate `event.input` |
| `context` | `additionalContext` side channel | `pi.sendMessage()` / `appendEntry` |
| `replace_output` | `updatedToolOutput`, **must match the tool's own output shape** | `tool_result` replace — typed, composes with prior handlers |
| `continue` | `decision:"block"` on Stop + `stop_hook_active` re-entry guard | `agent_before_settle` → one continuation, loop guard by design |
| `notify` | `systemMessage` | `ctx.ui.notify()` / `setStatus()` |

The `ask` row is the one real design change. Claude expresses "ask the user" as *data* returned
up the hook protocol. Pi has none, so `supports()` can no longer be the static per-event table
the Claude adapter uses — it must become **dynamic on `ctx.hasUI`**, because in a
non-interactive run `ask` is unexpressible and `shell-safety`'s safety fallback must become a
block instead. The agent's doc states this, but words it as "Pi has no permission-hook ask
result", which reads as *Pi cannot ask*. It can — `ctx.ui.confirm()` is exactly how, and the
gate extension it wrote does it.

### Four things Pi gives that the Claude hook protocol structurally cannot

1. **The shape-matching tax disappears.** Your own verified note (2026-10-03): *"`updatedToolOutput`
   must match the tool's own output shape (a plain string on Bash is ignored)"* — hence
   `shaped()`, and Bash wanting `{stdout, stderr, interrupted, isImage}`. `mcp-trim` and
   `read-budget` fight this today. In Pi, `tool_result` replaces typed content and later
   handlers see earlier changes.

2. **Half of `adapters/common.ts` stops existing.** The `finish()` once-guard, the
   `setTimeout(budget + 1500).unref()` deadline, always-exit-0, `safeNeutral()` on every
   exception path, and the sha1 marker directory with a 30-second dedupe window plus hourly
   sweep — all of it exists because a hook is a *separate process* and two config files can
   fire the same event (SKILL.md: Cursor loads both the plugin hooks and `~/.cursor/hooks.json`).
   In-process: one extension instance, no stdin, no exit code, no duplicate delivery.

3. **The prompt-lag workaround disappears.** SKILL.md: *"The prompt can lag in the transcript
   at PreToolUse, so `UserPromptSubmit` stashes it"* — which is why the Claude adapter needs
   `observe()` writing through `core/transcript.ts`. Pi's `input` event supplies the same
   information in-process, in order.

4. **Fail policy becomes exact rather than approximate.** `Decision.safety` currently fails to
   `ask` "only where the agent supports ask". With `ctx.hasUI` in `supports()`, that stops
   being a guess.

### What it loses

- **No transcript-path guarantee.** `ctx.sessionManager.getBranch()` + `ctx.getContextUsage()`
  replace it. This is the one adapter piece that is a real rewrite, not a mapping — the harness's
  task-context helper reads Claude's JSONL. The agent was right not to depend on `PI_SESSION_FILE`.
- `screenshot-gate` is inert — Pi has no built-in screenshot tool.
- `subagent-router` maps to pi-fabric's `spawn_agents`, whose model field is a Fabric alias.
- No output-schema enforcement for Jev answers, on either side.

### Bridge vs native — and why the bridge is a trap

The bridge execs `adapters/claude-code/run.ts` with a Claude-shaped envelope and translates
`permissionDecision` back. It looks like the cheap path. It isn't: the only thing it reuses is
those **94 lines of Claude-specific normalization** — exactly the part being replaced. The ~877
lines in `decisions/` are shared either way. So the bridge buys almost nothing, and inherits
the shape-matching tax, a process spawn per tool call, and the stash dance.

**Go native.** Keep the bridge only as a rollback for `shell-safety` during migration. The
agent's 10-step ordering is sound: shell-safety + shell-rules + repo-state + deploy-preflight →
read-budget → mcp-trim → injection-screen → promise-continue + loop-detector → failure-triage
and semantic-lint → outbound-leak and memory-hygiene → compact-advisor → subagent-router →
screenshot-gate.

---

## 2 & 3. What you can customise

Verified against installed 1.2.0 declarations with quoted signatures. Full detail in
`gate/docs/pi-mod-surface.md`. Ranked by value:

| Capability | What it buys | Claude plugin equivalent |
|---|---|---|
| `registerToolRenderer(resolver)` | Render **any** tool, including `mcp__*` names not yet registered (resumed session, server not connected). kshetra/Jaal JSON becomes tables. `next() ?? mine` falls through. | **None found** |
| `registerVirtualModel({ route })` | `route()` runs **per request** with `reason: user \| continuation \| retry \| direct`, returning model + thinking level. | `switchModelsOnFlag`/`model`/`effortLevel` are session-level |
| `ctx.ui.setWidget(key, content, {placement})` | Persistent pane above/below the editor; string[] or component factory. | **Unverified** |
| `setEditorComponent` + `CustomEditor` | Extend to keep editing/autocomplete/app keys; replace to lose them. `undefined` restores. | **None found** |
| `input` → `{action:"transform"}` | Silent prompt rewrite. | Prompt hooks, similar |
| `exposure` + `reachesTools` + codemode `searchTools`/`describeTool`/`describeNamespace` | Loadout control: `direct`/`model-only`/`codemode`/`deferred`/`hidden`. Your `job_*` tools become script-callable. | **None found** |
| `pi.events` | Process-local named bus. | Different surface (hook chain) |
| `ctx.executeTool` | Nested calls, transcript-omitted, usage accounted upward. | `$.tool.call`, parity unverified |
| `ctx.modelRegistry.streamSimple` | Second opinion **without spawning a CLI**. **Verified working** — see §0. | `$.model` exists |
| `annotations` via `pi.getAllTools()` | Drives permission gating. | Not exposed |
| `appendEntry` + `registerEntryRenderer` | Branch-scoped state, excluded from model context. | Different session API |
| `registerShortcut` / `registerFlag` | Key dispatch; startup-parsed flags. | Flags unverified |

Rows the agent could not verify are marked **unverified** rather than guessed — passed through
unlaundered.

---

## 4. Four defects found by hand, not by the agents

**1. The version skew invalidated every clean-typecheck claim.** *(fixed)*
Repo pinned `devDependencies` at 0.85.1 while the runtime is 1.2.0. `streamSimple` appears once
in 1.2.0's `model-registry.d.ts` and **zero times** in 0.85.1. Removing the cast
`ctx.modelRegistry as unknown as RegistryWithSimple` reproduced
`TS2339: Property 'streamSimple' does not exist on type 'ModelRegistry'`. All four agents were
writing 1.2.0 code against 0.85.1 types and silencing it with casts. Bumped; all casts now
unnecessary; verified by re-typecheck.

**2. The permission gate would prompt on every tool call.** *(open)*
The bundled built-in `read` definition carries **no** `annotations` key; only MCP resource tools
get `readOnlyHint`. The gate's `annotationNeedsApproval()` is true when
`!readOnlyHint && (destructiveHint ?? true || openWorldHint ?? true)` — so with
`annotations === undefined` it is **true for `read`, `grep`, `ls`, `bash`, `edit`, `write`**.
Every read becomes a confirm dialog. Built-ins need a per-tool table; annotations should apply
only to MCP and extension tools.

**3. The ramp→gate integration is wired to the wrong channel.** *(open)*
workbench emits `pi.events.emit("workbench.ramp", …)`; the gate listens on `pi.events.on("ramp", …)`.
Silent no-op — the payload is `unknown`, so nothing typechecks it and `aggression` stays `0`.
That is the argument for a shared typed channel constant, and a good illustration of why the
untyped bus is a footgun.

**4. `scripts/check-package.mjs` hardcodes `pkg.pi.extensions.length`.** *(open)*
All four branches edit the same line to a different number (`5→7`, `5→6`, …). Keep the
"entry exists / helper not listed" assertions, drop the count.

---

## 5. Decisions taken after the review

Four directives from Prasham on 2026-10-15, all reflected in `docs/explainer/index.html`. The first two are
carried in the explainer's §04; the plan's scope follows from the third.

1. **In-process native, everywhere.** No subprocess in the pack. The jev bridge is dropped rather than kept as a
   rollback, and the cockpit's `pi.exec("sqlite3", …)` read of `jev.db` becomes `bun:sqlite` — verified working
   in-process (`new Database(path, { readonly: true })`). Removing the shell-out also removes a PATH dependency and
   a 1500 ms timeout that sat inside the cockpit's draw path.
2. **Cockpit and duck dock right.** They become right-anchored, non-capturing overlays:
   `anchor: "right-center"`, `width: "38%"`, `maxHeight: "80%"`, `nonCapturing: true`,
   `visible: (w) => w >= 120`.
   Confirmed against the declarations: `OverlayAnchor` includes `"right-center"`, `SizeValue` accepts `"38%"`,
   and `nonCapturing` keeps the keyboard in the editor. **A persistent right dock is not possible** —
   `WidgetPlacement` is only `"aboveEditor" | "belowEditor"`, and an overlay lives only as long as its
   `ctx.ui.custom()` promise. A persistent presence must therefore be the footer or a widget.

3. **`gate` and `ramp` are out of scope for now.** Deferred, not cancelled. They were one system — workbench
   published an *aggression* value, gate consumed it to tighten permission prompts — so with no gate, ramp is a
   number nothing reads. `decorate` goes with them: it toasts a denial, and without a gate there is no denial to
   toast; it returns in the Jev phase, where shell-safety is a denial source.

   **Consequence for defects 2 and 3 below:** both are in gate/ramp code that is not shipping, so neither is
   urgent. Neither is fixed by the deferral — both must be fixed *before that code ships*, and both findings are
   preserved here precisely so they are not rediscovered: built-in tools carry no annotations, and the event bus is
   untyped so two extensions silently disagreed on a channel name.

4. **Provider usage reporting moves into scope, and corrects a non-goal.** The plan had listed "no 5h/7d quota
   display" because Pi's extension API exposes no rate-limit windows. That is true of Pi's API and **false of the
   provider's** — opencode-go serves them over HTTP:

   ```
   GET https://opencode.ai/zen/go/v1/usage      # Authorization: Bearer $OPENCODE_API_KEY
   {"usage":{"rolling":{"percent":2,"resetsAt":"2026-10-15T18:02:13Z"},
             "weekly" :{"percent":0,"resetsAt":"2026-10-19T00:00:00Z"},
             "monthly":{"percent":0,"resetsAt":"2026-11-15T12:17:12Z"}}}
   ```

   Verified by direct call: HTTP 200, 238 bytes, three windows, **percent only** — no tokens, no spend, and
   `/zen/go/v1/models` returns 37 entries of `{id, object, created, owned_by}` with no pricing. So opencode-go gets
   percent + reset times + locally-counted tokens and no dollar figure; Cloudflare keeps the opposite trade (real
   month-to-date USD from `billable-usage`, no percent). One `ProviderUsage` type covers both. Full spec:
   `docs/pi-mods-plan.md` §6.

## 6. Recommendations

1. ~~Bump to 1.2.0 and delete the casts.~~ **Done and verified** (§0).
2. **Re-run `tui` and `jev`** with real 1.2.0 types. Those two hold their value in code, and both
   were written blind. `tui`'s `workbench/pet.ts` is 27 lines ending in
   `void allVerbs; void themeOf; void iconRows;` to silence dead imports; `cockpit.ts` is 48;
   `docs/workbench.md` is 43 where a real port was the ask. The docs are good; the code is a sketch.
3. **Fix defects 2–4 before any merge.** Defect 2 makes Pi unusable in one prompt-per-read way;
   defect 3 silently disables the one cross-extension demo the whole design rests on.
4. **Keep `gate` and `pack` docs, rewrite the gate code.** Their value is documentation
   (`pi-mod-surface.md`, `packaging.md`); their code is a sketch.
5. **Then** do the jev native adapter for real: `adapters/pi/` + `AgentId | "pi"`, and delete
   the absolute-path type import of `~/.claude/skills/jev-harness/core/types.ts` so the package
   is portable.

### Not to be trusted without a manual TUI run

Interactive behaviour is unverifiable in print mode. Still needs a human at a real Pi session:
`ctx.ui.custom` panes and footer repainting, the confirm dialog and its 30 s timeout, widget
placement, theme changes, regular vs fullscreen layout, and the `/duck` widget.

---

## Provenance

| Agent | Produced | Independently verified by me |
|---|---|---|
| gate | `docs/pi-mod-surface.md` (191 l), `gate/`, `duck/`, 15 tests | signatures spot-checked in `types.d.ts`; **found defect 2**; removed the cast and retypechecked |
| jev | `docs/jev-adapter.md`, `extensions/jev/{index,lib/bridge,lib/native}.ts`, 13 tests | mapping table cross-checked against `decisions/` + `adapters/claude-code/run.ts`; portability defect noted |
| tui | `extensions/workbench/`, `docs/workbench.md`, 17 tests | **found defect 3** (channel mismatch); found the dead-import silences |
| pack | `docs/packaging.md`, `extensions/shared/{config,state}.ts`, 14 tests | read the conclusions; `userConfig`-absent and branch-state claims match the docs |
