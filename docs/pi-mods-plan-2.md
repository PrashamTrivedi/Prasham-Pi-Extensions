# Pi mods — plan 2 (reconciled with what already exists)

Companion to `docs/pi-mods-plan.md` (rev 2 — the design of record), `docs/pi-mods-review.md`,
and `docs/temp/pi-mod-surface.md` (the verified API inventory). This document does **not**
re-derive them. Its job is to add new work on top of them **without contradicting a locked
decision and without re-planning anything already built.**

Written 2026-10-16. Every claim below was read from the working tree, not recalled.

---

## 0. What already exists

| Artifact | State | Evidence |
|---|---|---|
| `docs/pi-mods-plan.md` rev 2 | Design of record: Phase 0–5, 6 locked decisions, non-goals, sequencing | read in full |
| `docs/pi-mods-review.md` | Four hand-verified defects; decisions taken 2026-10-15 | read in full |
| `docs/temp/pi-mod-surface.md` | 191-line verified 1.2.0 capability inventory with quoted signatures | read in full |
| `docs/temp/{workbench,jev-adapter,gate,packaging}.md` | Per-branch findings | read in full |
| `taskNotes/pi-mods-foundation/` | Active increment, **Specs A/B/C implemented** | `git status` |
| `extensions/shared/` + tests | `config`, `state`, `usage`, `ledger`, `ledger-server`, `index` | present |
| `extensions/usage/opencode-go.ts` + fixture | Reporter + exact live-payload fixture | present |
| `scripts/check-package.mjs` | Count assertion **removed** (Phase 0.1 done) | `git diff` |
| `pi.extensions` | 6 entries: fabric, sandbox-dev, project-context, recursive-context, cloudflare-ai-usage, sanitize-skill-names | `package.json` |

**The foundation increment is green and uncommitted.**

```
$ npm run check
 77 pass
 0 fail
Ran 77 tests across 13 files. [822.00ms]
Package manifest and public assets validated (6 extensions).
```

It is **not committed**, and it sits in a tree that also holds the unrelated uncommitted
`sandbox-dev` body of work. Spec A's second deliverable ("resolved dirty tree") is therefore
**not met**.

---

## 1. Corrections to carry forward

These invalidate things I said earlier, and one thing the plan's review said. They go first
because a plan built on them would otherwise be wrong at the root.

1. **The ledger is not read in-process — at all.** Pi executes extensions under **Node**
   (`dist/bundle/cli.js` is `#!/usr/bin/env node`), where `bun:sqlite` fails with
   `ERR_UNSUPPORTED_ESM_URL_SCHEME`; the test runner is **Bun**, where `node:sqlite` fails with
   `No such built-in module`. The foundation resolves this with a **Bun-run read-only HTTP
   server** (`extensions/shared/ledger-server.ts`, `Bun.serve` on `127.0.0.1:37650`) and a
   Node-safe client (`extensions/shared/ledger.ts`, `PI_JEV_LEDGER_URL`, `AbortSignal.timeout(2000)`,
   never throws → `{ rows, error }`).
   → **My earlier suggestion to read `jev.db` read-only in-process was wrong for the same reason**,
   and the review's "*`bun:sqlite` verified working in-process*" note is **superseded** — it was
   evidently verified under Bun, not under Pi.
   → **Amend locked decision #1** (see §3).
2. **The four mod worktrees are gone.** `mods/{gate,jev,pack,tui}` all point at `2ec2a7e` with
   empty diffs, `/tmp/pi-mods-lab/` no longer exists, and nothing is recoverable from
   `git stash`/`git fsck`. Their code must be **rewritten from the surviving docs**; nothing is
   cherry-pickable. `docs/temp/workbench.md` describes code that does not exist.
3. **Phase 0.1 is closed.** `check-package.mjs` no longer asserts a count and now also asserts
   each listed entry has a default export. Adding extension entries no longer requires editing
   the checker — so the cost of a new entry is now genuinely near-zero.
4. **`cloudflare-ai-usage.ts` is kept, not retired.** Its JSONL
   (`~/.pi/agent/state/cloudflare-ai-usage.jsonl`) is the Pi-side Cloudflare record. It renders only
   while a `cloudflare-workers-ai` model is active and clears its status otherwise, so it and
   `usage/` (opencode-go) never compete for the same line. Anything I add that records usage stays
   explicitly per-provider rather than merging the two.

---

## 2. Coverage map — what is genuinely new

Each row is one of my earlier proposals checked against the existing plan. "Covered" means the
plan already specifies it; I am not re-proposing those.

| Proposal | Existing coverage | Verdict |
|---|---|---|
| Unified session ledger (`/report`) | `shared/ledger.ts` is **Jev-only and read-only**. No Pi-side write path exists. | **New** — see I3.1 |
| MCP/Jaal `registerToolRenderer` | Surfaced in `pi-mod-surface.md` §1 as a Pi-only capability, **but absent from every phase** | **New** — see I4.1 |
| Fabric run forensics + worktree GC | Not covered. Runs live in `/tmp/pi-fabric/<root>/`; 12 worktrees currently `prunable` | **New** — see I7.1 |
| herdr Pi parity (tool activity, stop, blocked) | Documented gap list in `temp/packaging.md` §4; **not implemented** | **New** — coordinated, see I7.2 |
| Per-request model router | Not covered; no phase touches `registerVirtualModel` | **New** — see I6.1 |
| Exposure control for MCP tools | `pi-mod-surface.md` §7 only; not planned | **New** — see I6.2 |
| Nested classification calls | Covered **for `/duck` only** (Phase 4) | **Extended** — see I6.3 |
| Jev port ordering | Covered by Phase 5's 10-step order | **Change to an existing phase** — see I5.1 |
| Provider request/header interception | Listed in the inventory, absent from the plan | **New** — see I6.4 |
| Skill dedupe / precedence doctor | `sanitize-skill-names` covers frontmatter **only** | **Extended** — see I2.2 |
| Context-budget breakdown | Not covered. `getContextUsage()` returns a percentage only | **New** — see I4.2 |
| Loose-extension duplicate registration | README migration step 4 says do it; **not done** | **Blocker** — see I2.1 |
| `/handoff` | `shared/state.ts` exists as branch state; the feature does not | **New** — see I6.5 |
| Plan/todo persistence | Same — `shared/state.ts` is the substrate, unused | **New** — see I6.5 |

---

## 3. Locked decisions — which still hold

Carried forward unchanged from `docs/pi-mods-plan.md` §"Locked decisions", except #1.

1. **~~In-process native, everywhere.~~ ⚠️ AMENDED.** In-process native for **everything except
   the Jev ledger**. The ledger is read through the Bun-run server (§1.1). The original wording
   ("zero subprocesses, no jev bridge") is what produced the wrong SQLite assumption, so it is
   restated rather than quietly patched.
2. Cockpit and duck dock right as non-capturing overlays, hidden under 120 columns.
3. No `gate`, no `ramp` in this pass; `decorate` returns with `jev`.
4. Registered extensions + one shared library. `shared/` is **never** a manifest entry.
5. Typed against `@earendil-works/pi-coding-agent@1.2.0`; any `as unknown as` is a defect.
6. Feature flags live in `<name>.config.json`, not one entry per feature.
7. **NEW — the ledger is served, never embedded.** SQLite bindings live only in
   `ledger-server.ts`. Nothing in the Node extension graph may import `bun:sqlite` or
   `node:sqlite`. This is promoted from a footnote to a locked decision because #1 as written
   actively contradicted it.

---

## 4. Increments

Increment 1 is the in-flight foundation and is done bar the commit. The rest are ordered so each
leaves the tree green, and so that display work (statusline, cockpit) lands **after** the data it
displays.

| # | Increment | Contents | Value / effort | Depends on |
|---|---|---|---|---|
| **1** | **Foundation** *(in flight, green)* | commit Specs A/B/C; resolve the dirty tree into two commits (sandbox-dev, then pi-mods foundation) | — | — |
| **2** | **Hygiene** | 2.1 loose-extension cleanup · 2.2 `/skills doctor` | high / very low | 1 |
| **3** | **Usage, completed** | `usage/index.ts` (status segment, `message_end` accounting, refresh timer, `/usage`), `usage/opencode-go.ts`, `usage/config.ts`; `cloudflare-ai-usage.ts` kept and rendered only while its provider is active | high / low | 1 |
| **4** | **Workbench + session observability** | `pet`, `statusline` rewrite, `cockpit` (right overlay, consumes `shared/ledger.ts`) + **ledger-server lifecycle** (auto-start, port, health, shutdown) · **4.1 MCP renderer** · **4.2 context breakdown** · **4.3 session ledger write side** | high / medium | 3 |
| **5** | **Jev, in-process** | Phase 5 as written, with the reorder in 5.1. Needs `AgentId \| "pi"` in `~/.claude/skills/jev-harness/` | high / high | 1, 4 |
| **6** | **Capability** | 6.1 model router · 6.2 MCP exposure · 6.3 nested classification · 6.4 provider interception · 6.5 `/handoff` + plan state | high / medium-high | 3, 4 |
| **7** | **Fleet** | 7.1 fabric forensics + `/team gc` · 7.2 herdr parity | medium / low-medium | — (7.1 is independent) |

Detail for the new items only.

### I2.1 — Loose-extension cleanup *(blocker)*

`~/.pi/agent/extensions/` still holds `project-context.ts`, `recursive-context.ts`,
`cloudflare-ai-usage.ts`, `sanitize-skill-names.ts` and `pi-fabric/` — the same five the package
now ships. README migration step 4 warns this causes **duplicate tool registration and repeated
prompt injection**. Nothing is installed from this package yet (`settings.json → packages` holds
only `npm:pi-mcp-adapter`), so this is cheap now and expensive after the first `pi install`.
Move them outside Pi's auto-discovery directories; do not delete `herdr-agent-state.ts`, which is
herdr-managed.

### I2.2 — `/skills doctor` *(extend `sanitize-skill-names`)*

Verified today, not inferred: **15 skill names collide** between `~/.pi/agent/skills` and
`~/.agents/skills` — `agents-sdk`, `cloudflare`, `durable-objects`, `remotion`, `shadcn-ui`,
`typesafe-ai`, `web-perf`, `workers-best-practices`, `wrangler`, and six `stitch-*` — and
`~/.claude/skills` holds a third copy of most. Near-duplicates also exist
(`stitch-react-components` vs `react-components`, `design-md` vs `taste-design`). The loader
picks one copy by a precedence nobody has written down, so a stale copy can silently shadow a
current one.

Add to the existing preview-only command: name collisions across all three roots, which copy
wins and why, invalid frontmatter, and near-duplicate descriptions. Report first; apply only with
an explicit flag, as today.

### I4.1 — MCP result renderer

`registerToolRenderer((name, next) => …)` runs in load order and may match any name, including an
unregistered `mcp__*` tool — so kshetra/Jaal JSON renders as a table/diff, and `next() ?? mine`
is the clean fall-through. This is the one capability `pi-mod-surface.md` could find no Claude
equivalent for, and it is currently unplanned. Do not conflate with the tool's exposure (§6.2);
this is display only.

### I4.2 — Context-budget breakdown

`ctx.getContextUsage()` returns `tokens`, `contextWindow`, `percent` — never *what* is consuming
the window. The pack itself is a large consumer: `project-context` injects up to 8,000 chars and
`recursive-context` up to **200,000** chars (`PI_RECURSIVE_CONTEXT_MAX`). A `/context` breakdown —
tree, nested `AGENTS.md` by file, skills, MCP tool schemas — plus a statusline segment is the
cheapest high-value item in this document. It also makes §6.2 measurable.

### I4.3 — Session ledger write side

`shared/ledger.ts` reads the **Jev** ledger. Nothing records what *Pi* did. Add one append-only
JSONL (Node `fs`, which is safe in Pi) written on `tool_execution_start/end`, `message_end`
usage, and Fabric spawn/cancel: tool, args/result bytes, latency, tokens, cost, model. Then a
`/report` command and two new read-only endpoints on the existing `ledger-server.ts` (one server,
one client, per decision #7).

Two constraints: it must **subsume** `cloudflare-ai-usage.jsonl` rather than sit beside it (§1.4),
and the plan's open question — *does Pi expose a per-turn token/cost aggregate?* — is unresolved,
so cost is a running sum computed from assistant-message usage until it is answered.

### I5.1 — Reorder the Jev port

Phase 5's order is sound but front-loads blocking. `read-budget`, `mcp-trim` and `injection-screen`
are the three whose `tool_result` **replacement** changes what the next model request sees —
direct context and safety payoff, and `mcp-trim` is the case where Pi's typed replacement removes
Claude's shape-matching tax entirely. Ship those three first; the blocking decisions
(`shell-safety`, `deploy-preflight`, `outbound-leak`) come after, since we already respect them by
convention. Blocked on one experiment the plan already names: **does Pi re-validate `tool_call`
arguments after a handler mutates `event.input`?**

### I6.1 — Per-request model router

`registerVirtualModel({ route })` runs **per request** with
`reason: "user" | "continuation" | "retry" | "direct"`, returning model + thinking level. The
review found no Claude equivalent. Route cheap for `continuation`/`retry`, strong for `user`, and
fold in the `usage` windows from increment 3 — downgrade when `rolling` percent is high. This is
the largest single capability lever available and nothing in the plan touches it.

### I6.2 — Exposure control for MCP tools

`exposure: "codemode" | "deferred"` plus `searchTools`/`describeTool`/`describeNamespace` moves
kshetra/Jaal/`job_*`/`client_*` out of the always-declared set and into discovery. Verified
semantics in `pi-mod-surface.md` §7. Measure the win with I4.2, not by feel.

### I6.3 — Nested classification beyond `/duck`

`ctx.modelRegistry.streamSimple` is verified working, in-process, with usage accounted upward. The
highest-value second consumer is **`/drain-intents` comment classification** — correction vs
emphasis vs dispute vs standing preference — which today is done in the main context by the
session that must also act on it.

### I6.4 — Provider request/header interception

Present in the capability inventory, absent from every phase. Buy: AI Gateway metadata, outbound
redaction, and a request log that I4.3 can record.

### I6.5 — `/handoff` and plan state

`shared/state.ts` already gives branch-scoped, model-context-excluded state via `appendEntry` — and
nothing uses it. Two consumers: a `/handoff` artifact (decisions, open threads, next actions) and
persistent plan/todo state, both rendered with `registerEntryRenderer`.

### I7.1 — Fabric run forensics

`extensions/fabric/activity.ts` publishes to `/tmp/pi-fabric/<root-id>/` — temporary storage that
is not a backup, by the pack's own SECURITY.md. Add a durable run archive and a `/team gc` for
finished-run worktrees (12 are `prunable` right now, across `/tmp/pi-fabric/` and the dead
`/tmp/pi-mods-lab/`). Independent of everything else.

### I7.2 — herdr parity

Pi reports session start, working, idle and blocked over `HERDR_ENV`, and **no tool activity and no
session stop**. `temp/packaging.md` §4 says to have herdr regenerate the managed integration rather
than patching the installed file — keep it that way; this is a coordination item, not repo code.

---

## 5. Definition of done (every increment)

Inherited from `docs/pi-mods-plan.md` §1, plus the amendments:

- [ ] `npm run check` green: typecheck, tests, manifest.
- [ ] No `as any` / `as unknown as`. No `child_process` / `pi.exec`.
- [ ] **No `bun:sqlite` / `node:sqlite` anywhere in the Node extension graph** (decision #7).
- [ ] Loads in both `tui` and `print`, `ctx.mode !== "tui"` guarded wherever UI is called.
- [ ] Degrades safely on missing config, missing `jev.db`, missing ledger server, no UI.
- [ ] Tests for pure logic; interactive rendering gets a written manual-check list.
- [ ] No network in tests — injected `fetchImpl` only.

---

## 6. Open questions carried forward

| Question | Blocks | How to settle |
|---|---|---|
| Does Pi expose a per-turn token/cost aggregate? | I4.3 cost figures | read `dist/core/extensions/types.d.ts`; the plan already lists it open |
| Does Pi re-validate `tool_call` args after `event.input` mutation? | I5.1 `read-budget` | one experiment |
| Does `nonCapturing` hold input while typing? | I4 cockpit | one manual TUI run; fall back to `setWidget` |
| Is `/zen/go/v1/usage` stable? | increment 3 | fixture test fails loudly on shape change |
| Which skill copy wins on a name collision? | I2.2 | instrument the loader, or read Pi's resource discovery |

---

## Provenance

Read from disk: `docs/pi-mods-plan.md`, `docs/pi-mods-review.md`, `docs/temp/pi-mod-surface.md`,
`docs/temp/{workbench,jev-adapter,gate,packaging}.md`, `docs/temp/sandbox-migration/05-native-markdown.md`,
`taskNotes/pi-mods-foundation/{taskFindings.md,specs/specs.md}`,
`extensions/shared/{index,ledger,ledger-server}.ts`, `package.json`, `git status`, `git diff`,
`git worktree list`. Executed: `npm run check` (77 pass, 0 fail, 6 extensions).
Skill-collision counts were produced by listing the three skill roots and counting `^name:`
occurrences, not estimated.
