# Migrating Claude Code's `sandbox-dev` workflow to native Pi

Research date: 2026-10. Pi reference: `@earendil-works/pi-coding-agent@1.2.0` (repo devDependency + installed).
Source artifacts: `/root/.claude/skills/sandbox-dev/SKILL.md`, `/root/.claude/commands/{codePlanner,startWork,completeWork}.md`,
plus the Claude-only glue they lean on (`/goal`, auto/sandbox permission modes, `hud`, `Task`, `TodoWrite`).

Evidence: four Fabric workers (`docs/temp/sandbox-migration/` in their worktrees, patches under
`/tmp/pi-fabric/<root>/outputs/`) and the Pi 1.2.0 docs/source.

---

## 1. Verdict

The workflow is mostly portable prose wrapped around three ideas that are the actual point of the port.
Everything else (the digest table, the HUD calls, the branch rules) is ceremony serving those ideas.

**The three targets:**

| Target | Where it lives now | Pi mechanism |
|---|---|---|
| **Minimal permission model** — what an unattended run may do | Phase 0 preflight (`CLAUDE_CODE_SANDBOXED`, `permissions.defaultMode`) | one `tool_call`/`user_bash` gate extension with a short allow/confirm/deny policy, fail-closed without UI |
| **Explicit plan approval** — the human must read and approve, not skim past | Phase 2 digest + `Ready? [g]o · [t]weak · [r]eject` | extension reads the plan from disk, presents the typed g / t / r gate, binds approval to a plan hash |
| **Single-outcome anchoring** — the run stays pegged to one outcome | `/goal` envelope | `agent_before_settle` supervisor that judges only the stated outcome, with a turn budget |

Split the artifacts accordingly:

| Layer | Pi artifact | Why |
|---|---|---|
| Loop narrative, digest format, acceptance checklist | **`skills/sandbox-dev/SKILL.md`** | plain instructions, advertised by name/description |
| `/codePlanner`, `/startWork`, `/completeWork` text bodies | **`prompts/*.md`** prompt templates | expand to a user message; `$ARGUMENTS` already works |
| The three targets | **`extensions/sandbox-dev/`** | markdown can *ask* the model to stop; only executable hooks can *force* it |

Two facts drive the design:

1. **Pi has no permission system and no built-in sandbox.** `docs/security.md`: Pi "does not ask for approval
   before every tool call." No `permissions.defaultMode`, no `/sandbox`, no `CLAUDE_CODE_SANDBOXED`, no network
   allowlist. Isolation is external (Docker/OpenShell/Gondolin) or the opt-in `examples/extensions/sandbox/`.
   So the permission model is not translated — it is *authored*, and kept deliberately small.
2. **Pi has no `/goal`, no `Task`, no `TodoWrite`, no `Skill` tool, no HUD.** Each has a Pi-shaped
   replacement: `agent_before_settle` continuation, Fabric `spawn_agents`, advertise-and-`read`,
   and `ctx.ui.setStatus/setWidget`.

Also important: **Fabric workers load `--no-extensions` and run in `-p` print mode**
(`--no-session --approve --no-extensions --extension <fabric>`). A sandbox-dev extension is *not* present in
workers, and print mode has no UI, so no worker can ever hit the approval gate or the permission gate.

---

## 2. Zero-copy bridge (try it today)

Pi never reads `.claude/` (grep of `dist/`, `docs/`, `schemas/` finds no path handling; only `CLAUDE.md` as a
context file). But `settings.skills` / `settings.prompts` accept arbitrary directories, so you can load the
existing Claude resources unchanged:

```jsonc
// ~/.pi/agent/settings.json
{
  "skills":  ["/root/.claude/skills"],     // recursive: finds sandbox-dev/SKILL.md
  "prompts": ["/root/.claude/commands"]    // direct .md children only (no git/ subdir)
}
```

That gets you `/skill:sandbox-dev`, `/codePlanner`, `/startWork`, `/completeWork` immediately. What silently
degrades:

- `allowed-tools` is parsed but **never enforced** (Pi has no per-tool allowlist).
- Skill/command `hooks:` maps are ignored; the codePlanner "no TodoWrite" block and parakh's localhost block disappear.
- `$ARGUMENT` (singular, codePlanner) is **not** substituted → becomes literal text. Only `$ARGUMENTS`, `$@`, `$1`, `${1:-default}` work.
- `@taskNotes/...` file inlining does not exist in Pi templates → must become explicit `read` calls.
- `/goal`, `/sandbox`, `/permissions`, `hud`, `Task`, `TodoWrite` references remain dead text — i.e. all three targets are absent.

Fine as a smoke test; the three targets must be built.

---

## 3. Field-by-field mapping

### 3.1 Skill frontmatter

| Claude Code | Pi | Handling |
|---|---|---|
| `name` | `name` | used; validated `^[a-z0-9-]+$`, ≤64 chars; warnings only |
| `description` | `description` | used; **required** or the skill is not loaded; ≤1024 |
| `allowed-tools` | `allowed-tools` | parsed, **ignored** — keep for portability or delete |
| — | `disable-model-invocation: true` | hides from auto-selection; `/skill:name` still works |
| `license`/`compatibility`/`metadata` | same | accepted per Agent Skills spec |

### 3.2 Command frontmatter → prompt template

| Claude Code | Pi template | Handling |
|---|---|---|
| `description` | `description` | used in completion |
| `argument-hint` | `argument-hint` | used |
| `allowed-tools` | — | ignored |
| `model` | — | ignored (templates can't pick a model) |
| `hooks:` | — | ignored → re-implement in the extension |
| `name` | — | ignored; command name = filename |

### 3.3 Tool / feature equivalents

| Claude Code | Pi | Status |
|---|---|---|
| `Bash`/`Read`/`Write`/`Edit` | `bash`/`read`/`write`/`edit` | exists (defaults: `read,bash,edit,write`) |
| `MultiEdit` | `edit` with `edits: [{oldText,newText},…]` | exists |
| `Grep`/`Glob` | `grep`/`find` | exists but **not in default tool set**; enable with `"+grep"` |
| `Task` / subagents | Fabric `spawn_agents`/`await_agents` | exists (worktrees, patches, recursion) |
| `TodoWrite` | none; `examples/extensions/todo.ts` | gap (low value) |
| `Skill` | advertise + `read` + `/skill:name` | exists, different mechanism |
| `WebSearch`/`WebFetch` | none built-in; MCP (jina) or extension | gap |
| `mcp__github__*` | MCP `mcp__<server>__<tool>` | needs a server; **`gh` is the real path** |
| `/goal` | `agent_before_settle` + budget | gap, buildable (target 3) |
| `/sandbox`, auto mode | `tool_call` gate (+ external container) | gap, authored (target 1) |
| `hud` binary | `ctx.ui.setStatus/setWidget` + `appendEntry` | gap, replace |
| `@path` inlining | explicit `read` | syntax gap |

---

## 4. The three design targets

These are the reason to port at all. Each maps to exactly one extension mechanism; the rest is prose.

### 4.1 Minimal permission model (was Phase 0)

**Goal:** the smallest legible policy that decides what an unattended run may do. Not an emulation of
Claude's auto-mode classifier or its sandbox mode — Pi defaults to allow-all, so the model is a short
explicit list plus a fail-closed fallback.

**Design:**

- Three buckets, defined in one JSON file (`examples/sandbox-dev.config.json`) and a pure `rules.ts`:
  - **allow** (default): reads; writes/edits inside the repo; tests, builds, linters.
  - **confirm**: irreversible or outward-facing — `git push`, deleting outside build dirs, dependency/network
    installs, PR/issue writes, any write outside the repo root.
  - **deny**: secret material (`~/.ssh`, `.env*`, credentials), `sudo`, force-push to main, `curl | sh`.
- **Fail closed when `!ctx.hasUI`:** confirm-bucket calls are blocked, not allowed. Pi's own behavior is
  allow-all, so the blocks must be explicit.
- **No mode detection.** The extension *is* the mode. It publishes its state next to the task (one line via
  `before_agent_start`, plus a status/widget) so the skill never probes env or settings. Phase 0 shrinks to:
  confirm the repo root, confirm the task token, and read the gate's reported mode.
- **Non-goals:** classifying every command with a model, emulating `permissions.defaultMode`, or claiming a
  security boundary. A real boundary stays external — a container (`docs/containerization.md`) or
  `examples/extensions/sandbox/` (`@anthropic-ai/sandbox-runtime`).

```ts
// extension-owned; rules.ts stays pure and unit-tested
pi.on("tool_call", async (event, ctx) => {
  if (READ_ONLY.has(event.toolName)) return;
  const verdict = classify(event.toolName, event.input);   // "allow" | "confirm" | "deny"
  if (verdict === "allow") return;
  if (verdict === "deny") return { block: true, reason: "sandbox-dev: denied by policy" };
  if (!ctx.hasUI) return { block: true, reason: "sandbox-dev: confirmation required, no UI (fail closed)" };
  const ok = await ctx.ui.confirm("sandbox-dev permission", describe(event));
  return ok ? undefined : { block: true, reason: "Denied by user" };
});
pi.on("user_bash", (event, ctx) => gateUserBash(event, ctx)); // `!` commands bypass tool_call
```

Fail-safe by construction: a throwing `tool_call` handler blocks the call.

### 4.2 Explicit plan approval (was Phase 2)

**Goal:** force the human to actually read the plan and approve it. The digest table is a reading aid, not
the deliverable; the mechanism must make approval impossible to skip, impossible to default, and invalid as
soon as the plan changes.

**Design:**

- **The extension reads the plan from disk** (`taskNotes/<task>/taskFindings.md`) and prints it — full plan,
  or a paged view. Never let a model-authored summary be the thing that gets approved.
- **Affirmative, non-defaultable approval.** Show the digest (complexity, gaps, edge cases, risks, files
  touched) for orientation, then present the original typed gate via `ctx.ui.input`: **`g`** approves,
  **`t: <feedback>`** (or `t` alone, which opens `ctx.ui.editor`) returns feedback, **`r`** displays the
  full plan and re-presents the gate. Any other non-empty text is feedback; a cancelled prompt never approves.
- **Bind approval to content.** Hash the plan file; persist `{ task, planHash, approvedAt }` via
  `pi.appendEntry("sandbox-dev-approval", …)`. Editing the plan after approval invalidates it and re-arms
  the gate.
- **Hard stop, not auto-continue.** The run ends at the gate. Implementation starts only from the approval
  handler calling `pi.sendUserMessage("/startWork …")` (or the user doing so). Nothing may continue through
  it.
- **No UI (print/RPC):** print the full plan plus instructions and stop. Never auto-approve. Expose
  `/dev-approve` (or a `dev_checkpoint` tool with an `agent_end` safety net) so the gate does not depend on
  the model remembering to call a tool.

```ts
pi.registerCommand("dev-approve", {
  description: "Print the plan and require explicit approval before implementation",
  handler: async (args, ctx) => {
    const task = resolveTask(args, ctx);
    const plan = readPlan(task);                       // extension reads disk, not the model's summary
    if (!ctx.hasUI) { printAndStop(plan); return; }    // never auto-approve
    for (;;) {
      const reply = (await ctx.ui.input(`Plan ${task} - ${GATE_HINT}`))?.trim();
      if (reply === undefined) { ctx.ui.notify("Cancelled; plan unchanged.", "warning"); return; }
      if (["g", "go", "yes"].includes(reply.toLowerCase())) break;
      if (["r", "reject", "show"].includes(reply.toLowerCase())) { await ctx.ui.editor(`Plan: ${task}`, plan); continue; }
      const feedback = reply.replace(/^(t|tweak)\s*:\s*/i, "").trim();
      if (feedback) { pi.sendUserMessage(`Plan not approved. Feedback: ${feedback}`); return; }
    }
    pi.appendEntry("sandbox-dev-approval", { task, planHash: hashPlan(plan), approvedAt: Date.now() });
    pi.sendUserMessage(`/startWork taskNotes/${task}/taskFindings.md, mode: autonomous`);
  },
});
```

The `agent_end` fallback (already demonstrated in `examples/extensions/plan-mode`) re-presents the same gate
if the run reaches the checkpoint without going through the command.

### 4.3 Single-outcome anchoring (was `/goal`)

**Goal:** keep the run pegged to one outcome, so it cannot drift, gold-plate, or declare victory on partial
evidence. The supervisor's only job is "is *this one outcome* satisfied by what the transcript shows?"

**Design:**

- **Capture the outcome verbatim at approval time**, from the plan's `Original Ask` / acceptance criteria.
  One string, one predicate, stored with the plan hash. Approval and anchoring are the same moment.
- **One question only:** does the transcript evidence satisfy this outcome? Green tests, clean lint, and 0
  review findings are *evidence*, not the outcome — they never substitute for it.
- **Restate the anchor on every continuation** (`continue: true` requires an entry anyway): outcome verbatim,
  turn/budget, and what evidence is still missing. Drift becomes visible in the transcript instead of silent.
- **Scope guard:** work proposed outside the outcome is not continued. The supervisor stops and surfaces it
  as "new outcome → new plan", rather than letting the run absorb it.
- **Stop conditions:** outcome met; budget exhausted; two consecutive checks with no new evidence (stall);
  or `outcome !== "completed"` (abort/error). Never continue unconditionally.

```ts
pi.on("agent_before_settle", async (event, ctx) => {
  if (event.outcome !== "completed" || !anchor || turnsUsed >= anchor.budget) return;
  const verdict = await judgeOutcome(ctx, anchor.outcome, event.context.llmMessages); // transcript-only
  if (verdict.met) return;
  if (stalled(event.context.llmMessages)) return { entries: [stallNotice()] };  // stop, no continue
  turnsUsed++;
  return { continue: true, entries: [{
    type: "custom_message", customType: "sandbox-dev-outcome", display: true,
    content: `OUTCOME (unchanged): ${anchor.outcome}\nTurn ${turnsUsed}/${anchor.budget}. Still missing: ${verdict.missing}`,
  }] };
});
```

The evaluator sees only the transcript, so the skill must echo raw evidence (exit codes, test summary lines).
The anchor is not armed until an approval entry exists — otherwise the supervisor would blow straight through
the Phase-2 gate.

### 4.4 HUD → native status

| hud call | Pi |
|---|---|
| `hud set … -s running -p N -l "…"` | `ctx.ui.setStatus("sandbox-dev", …)` + `ctx.ui.setWidget("sandbox-dev", lines)` |
| long-lived progress cards | `pi.appendEntry("sandbox-dev-phase", state)` + `pi.registerEntryRenderer(...)` |
| `hud ok/fail` | `ctx.ui.notify(..., "info"|"error")` |
| "running tool" line | `pi.on("tool_execution_end", …)` |

Guard TUI-only widgets with `ctx.mode === "tui"`, and reinstall them on `session_start` because `/reload`
tears the runtime down.

### 4.5 `Task` → Fabric (independent tracks only)

`spawn_agents` takes `{ agents: [{ model, task, label }] }`; children get a fresh worktree at committed HEAD
and return final text plus a binary-safe patch. Constraints to design around:

- Workers are `pi -p --no-session --approve --no-extensions --extension <fabric>` → **no UI, no MCP, no
  sandbox-dev extension, no steering, no mid-run checkpoint, no peer mailbox**.
- `--approve` is project trust, not tool approval.
- Neither parent conversation nor uncommitted edits are inherited → each `task` must be fully self-contained.
- Without a `pi-fabric.config.json` hierarchy, children must use the exact current model.

So Fabric replaces `Task` for team-build-style independent tracks and plan fan-out, but **not** the gated
sub-agent of the original flow.

---

## 5. Target file layout

```text
Prasham-Pi-Extensions/
├── package.json                     # add the new paths to "pi"
├── skills/sandbox-dev/SKILL.md      # the 5-phase loop; no allowed-tools, no /goal, no hud
├── prompts/                         # text-only compatibility commands
│   ├── codePlanner.md
│   ├── startWork.md
│   └── completeWork.md
├── extensions/sandbox-dev/
│   ├── index.ts                     # commands + gate + approval + supervisor + status
│   ├── state.ts                     # phase + approval/outcome state via appendEntry (pure)
│   ├── rules.ts                     # permission policy (pure, unit-tested)
│   ├── approval.ts                  # plan read/hash/digest + blocking approval UI
│   └── ui.ts                        # widget/status renderers
├── examples/sandbox-dev.config.json # allow/confirm/deny rules, turn budget
└── tests/sandbox-dev/{rules,state}.test.ts
```

```jsonc
"pi": {
  "extensions": ["./extensions/fabric/index.ts", "./extensions/sandbox-dev/index.ts", /* … */],
  "skills": ["./skills"],
  "prompts": ["./prompts"]
}
```

An extension command **shadows** a same-named template (command → `input` → skill → template), so keep the
markdown as the text body and register the extension command only where approval, state, or gating needs it.

---

## 6. Command rewrites (mechanical)

| Issue | Fix |
|---|---|
| `$ARGUMENT` singular | → `$ARGUMENTS` |
| `@taskNotes/{dir}/taskFindings.md` | → "read `taskNotes/{dir}/taskFindings.md` with the read tool" |
| `TodoWrite` ban via PreToolUse hook | `pi.on("tool_call")` → `{ block: true, reason: … }` when `toolName === "todo"` |
| `/goal …` blocks | delete; replaced by the single-outcome anchor |
| `/code-review`, `/security-review` | not built-in → author as review prompts driven by Fabric fan-out |
| `hud …` lines | delete, or keep as `2>/dev/null || true` no-ops until the status layer lands |
| `Skill` references ("use the Conventional Commit skill") | "read `…/skills/conventional-commit/SKILL.md`" or `/skill:conventional-commit` |
| `.claude/agents/*.md` personas | Fabric task prompt templates (or a small persona registry) |

---

## 7. Phased plan

**P0 — the three targets work end to end**
1. `extensions/sandbox-dev/rules.ts` + `tool_call`/`user_bash` gate: allow/confirm/deny, fail-closed without
   UI, config file. (Target 1)
2. `/dev-approve`: read the plan from disk, present go / tweak / show, hash-bound approval entry, hard stop.
   entry, hard stop. (Target 2)
3. `agent_before_settle` supervisor: outcome captured from the plan at approval, restated on each
   continuation, turn budget + stall detection. (Target 3)
4. Copy `SKILL.md` to `skills/sandbox-dev/`; strip `allowed-tools`, `/goal`, `/sandbox`, `hud`, `@file`,
   `$ARGUMENT`; Phase 0 becomes "read the gate's reported mode".
5. Add `prompts/{codePlanner,startWork,completeWork}.md` with the §6 fixes.
6. Decide the real-boundary story (container or vendored sandbox extension) and state it in Phase 0.

**P1 — makes it good**
7. Port `checkpoint-validator`, `conventional-commit`, `dependency-auditor` as Pi skills.
8. Review/security fan-out via `spawn_agents`; pick `gh` over an unregistered GitHub MCP.
9. Phase status widget + `appendEntry` cards (HUD replacement).

**P2 — optional**
10. Todo tool, `/tree` worktree UX, hud shim, haiku/gemini command variants, memory/parakh MCP registration.

---

## 8. Gotchas

1. Fabric workers never load the sandbox-dev extension and run with no UI — gate and approval are TUI/RPC-only.
2. `--approve` ≠ tool approval; it only grants project trust.
3. `allowed-tools` and skill-level `hooks` are inert in Pi; the codePlanner TodoWrite block and parakh
   localhost block vanish silently unless re-implemented.
4. Commands/templates cost context; keep the skill as the single source of prose and reference it from commands.
5. `/reload` wipes in-memory extension state and widgets; rebuild from `ctx.sessionManager.getBranch()` on `session_start`.
6. `pi.sendUserMessage` throws while streaming unless `deliverAs` is given — `await ctx.waitForIdle()` in commands.
7. An approval entry is the only thing that arms the outcome supervisor; never arm it from the skill text.
8. Keep `rules.ts` pure and tested; Fabric already injects a system-prompt paragraph, so don't add a second.

---

## 9. v1 status

Implemented in this repo:

| Artifact | Purpose |
|---|---|
| `skills/sandbox-dev/SKILL.md` | The five-phase loop, rewritten for Pi (no `allowed-tools`, no `/goal`, no `hud`, no env probing) |
| `prompts/{codePlanner,startWork,completeWork}.md` | Native `/codePlanner`, `/startWork`, `/completeWork` templates |
| `extensions/sandbox-dev/rules.ts` | Pure allow/confirm/deny policy (`classifyToolCall`, `matchPattern`, `isOutsideCwd`, `mergeConfig`) |
| `extensions/sandbox-dev/config.ts` | Global + project config loading, malformed files ignored |
| `extensions/sandbox-dev/state.ts` | Plan hash, `Original Ask` extraction, approval/outcome entry helpers |
| `extensions/sandbox-dev/index.ts` | Gate, `dev_request_approval`, `dev_outcome_met`, `/dev-approve`, `/dev-status`, `/dev-reset`, anchor supervisor, procedure-path reporting |
| `examples/sandbox-dev.json` | Example policy |
| `tests/sandbox-dev/*` | Policy, state, and wiring tests |

Deliberate v1 cuts:

- No model-based outcome evaluator. The agent declares the outcome via `dev_outcome_met` with evidence; the supervisor enforces the anchor and turn budget.
- The permission gate is policy, not a boundary. A permitted `bash` call is unrestricted; real isolation stays external.
- Fabric workers still run `--no-extensions`, so the gate, approval, and supervisor are inactive inside a worker.
- `turn_end` stall detection is not implemented; the budget is the backstop.
