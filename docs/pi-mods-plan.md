# Pi mod pack — implementation plan

Companion to `docs/pi-mods-review.md` (what happened) and `docs/explainer/index.html` (how it will look).

**Revision 2 (2026-10-15).** `gate` and `ramp` are **out of scope for now** — both deferred, not cancelled.
Provider usage reporting is **added**, and researching it replaced one stated non-goal.

**Locked decisions:**

1. **In-process native, everywhere.** Zero subprocesses in the pack. No jev bridge.
2. **Cockpit and duck dock right** as non-capturing overlays, hidden under 120 columns.
3. **No `gate`, no `ramp` in this pass.** `decorate` goes with them — it had no denial source without a gate.
4. Registered extensions + one shared library. `shared/` is **not** an extension entry point.
5. Typed against `@earendil-works/pi-coding-agent@1.2.0` (done). Any `as unknown as` cast is a defect.
6. Feature flags in `<name>.config.json`, not one extension entry per feature. Rationale in §3.

---

## 1. Definition of done

- [ ] `npm run check` green: typecheck, tests, manifest validation.
- [ ] No `as unknown as`, no `as any` in `extensions/**` (pre-existing `fabric/index.ts:149` is grandfathered).
- [ ] No `child_process` / `pi.exec` in any new extension.
- [ ] Every extension loads in **both** `tui` and `print` mode without throwing — `ctx.mode !== "tui"` guarded everywhere a UI call happens.
- [ ] Degrades safely on: missing config, missing `jev.db`, missing `OPENCODE_API_KEY`, unreachable usage API, no UI. None of these throw.
- [ ] Tests for pure logic. UI rendering gets a written manual-check list instead.
- [ ] One `docs/<name>.md` per extension; `package.json` → `pi.extensions` lists exactly the entry points.

---

## 2. Scope

| Extension | Is | Entry point | Rough size |
|---|---|---|---|
| `shared` *(library)* | config loader, branch state, provider-usage types, sqlite ledger reader | — (imported, never registered) | ~300 l |
| `usage` | provider usage reporting: opencode-go quotas + Cloudflare neurons/spend | `extensions/usage/index.ts` | ~320 l |
| `workbench` | pet, statusline, cockpit | `extensions/workbench/index.ts` | ~420 l |
| `duck` | `/duck` question-only second opinion | `extensions/duck/index.ts` | ~120 l |
| `jev` | in-process decision adapter + `decorate` | `extensions/jev/index.ts` | ~320 l |
| *(shipped)* | fabric, project-context, recursive-context, cloudflare-ai-usage, sanitize-skill-names | as-is | — |

### Deferred, with the reason

| | Why deferred | Comes back when |
|---|---|---|
| `gate` | Not wanted in this pass. Its only blocker-shaped defect (the annotation rule) is moot while it is off. | The safety gate is wanted again. Its design is intact in `docs/pi-mods-review.md` §4 defect 2 and in `docs/temp/gate.md`. |
| `ramp` | Its only consumer was `gate`. Aggression exists to tighten a guard; without a guard it is a number nothing reads. | `gate` lands. |
| `decorate` | It toasts a *denial*. With no gate there is no denial to toast. | `jev` lands — Jev's shell-safety is a denial source, so `decorate` moves into that phase. |
| `shared/channels.ts` | Its one purpose was the ramp→gate channel. Dead weight with both gone. | `ramp` returns. |

`cloudflare-ai-usage.ts` stays a first-class extension. It reports only while a `cloudflare-workers-ai` model is
active and clears its status otherwise, so it and `usage/` coexist without competing for the same status line;
they are deliberately not merged (see `docs/usage.md`).

---

## 3. Why one `workbench` entry rather than three

Pi's `pi config` toggles *extension entries*, so splitting would give per-feature on/off in that UI. It would not
give the numeric options — `pi config` cannot express extension-specific schema at all. So we would pay three load
units and three manifest entries for toggles we then duplicate in JSON anyway. One entry;
`workbench.config.json` = `{ pet, statusline, cockpit }`; each feature registers inside its own `try` so one broken
feature cannot take the others down.

---

## 4. Phase 0 — clear the blockers

| # | Item | Exit criterion |
|---|---|---|
| 0.1 | **`check-package.mjs`.** Drop `assert.equal(pkg.pi.extensions.length, N)` — four worktree branches all edited that one line. Keep "entry exists" and "helper not listed"; add "every listed entry has a default export". | Check passes for 4–8 entries without editing the script again. |
| 0.2 | **Re-base the worktrees** on the bumped `main`. Delete `jev/lib/bridge.ts`; **do not** import gate/ramp code. | `tsc --noEmit` clean on 1.2.0 with no casts. |

**Honest starting point.** The four worktrees added **11 tests total** (5 + 1 + 3 + 2), not the 17/13/15/14 their
result packets implied — those counts were dominated by the 12 pre-existing tests. Treat new code as untested.
Named rewrites: `statusline.ts` (one minified line), `decorate.ts` (logic is wrong — it treats
`event.input.block === true` as a denial source, which is not a thing), `cockpit.ts` (rewrite for the right rail).
Keep: `shared/config.ts`, `shared/state.ts`, `workbench/lib/logic.ts`.

---

## 5. Phase 1 — `shared/` foundation

Lands alone, first, because everything imports it.

| File | Contents |
|---|---|
| `config.ts` | `loadConfig` (project `.pi` → cwd → agent dir → extension dir), `objectValidator`, primitive guards. **Add** numeric clamp helpers. |
| `state.ts` | `stateFromBranch`, `BranchState` — branch-aware, excluded from model context. Keep as-is. |
| `usage.ts` | `UsageWindow`, `ProviderUsage` types + a `formatUsage()` renderer shared by the statusline and cockpit. |
| `ledger.ts` | Read-only `bun:sqlite` reader over `~/.jev-harness/jev.db`. |
| `index.ts` | Barrel. |

```ts
export type UsageWindow = { label: string; percent: number | null; resetsAt?: string };
export type ProviderUsage = {
  provider: string;                       // "opencode-go" | "cloudflare-workers-ai"
  windows: UsageWindow[];                 // rolling / weekly / monthly, or empty
  tokensToday?: { input: number; output: number };
  usdMtd?: number;                        // Cloudflare only — its billing API has it
  note?: string;                          // e.g. "no cost API for this provider"
  error?: string;
};
```

`ledger.ts` opens with `new Database(path, { readonly: true })` (verified working in-process), lazily on first call,
cached per process, closed on `session_shutdown`. Returns `{ rows: [], error }` for a missing file — never throws.
**No writes, ever** — the ledger is the harness's.

**Acceptance:** config precedence test (project beats agent dir); invalid JSON falls back to defaults and reports the
error; `stateFromBranch` ignores abandoned-branch entries; `recentCalls` returns `[]` + an error for a missing file
and rows for a fixture db.

---

## 6. Phase 2 — `usage` (new)

The pattern already exists in `cloudflare-ai-usage.ts`: per-assistant-message accounting appended to a JSONL, plus a
provider API poll for the authoritative figure, rendered as a status segment **only while that provider is active**
and cleared when the model switches. This phase generalises it and adds opencode-go.

### 6.1 opencode-go — verified against the live API

While researching this I found the quota endpoints, which corrects a non-goal I had stated. Pi's extension API
exposes no rate-limit windows — but **the provider does over HTTP**:

```
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer $OPENCODE_API_KEY
```

```json
{"usage":{"rolling":{"status":"ok","percent":2,"resetsAt":"2026-10-15T18:02:13.000Z"},
          "weekly" :{"status":"ok","percent":0,"resetsAt":"2026-10-19T00:00:00.000Z"},
          "monthly":{"status":"ok","percent":0,"resetsAt":"2026-11-15T12:17:12.000Z"}}}
```

Verified by direct call: HTTP 200, 238 bytes, three windows, percentage-only. `rolling` resets hours out,
`weekly` lands on a Monday, `monthly` on the 15th. This is the direct analogue of Claude Code's 5h/7d windows.

**What the API does *not* give:** any token count, any cost, and no rate-limit headers. `GET /zen/go/v1/models`
returns 37 entries of `{id, object, created, owned_by}` — **no pricing**. So for opencode-go we report percent and
reset times, plus locally-counted tokens, and **no dollar figure**. Do not estimate one from a price list we do not
have.

### 6.2 Cloudflare — unchanged in substance

`cloudflare-ai-usage.ts` already does the harder half: per-model rates × token usage → USD → neurons, a
`~X/10,000 N` daily allowance readout, and month-to-date USD from the `billable-usage` API. Port it behind the
`ProviderUsage` interface rather than rewriting it.

### 6.3 The shape

| File | Contents |
|---|---|
| `usage/types.ts` | the interfaces, re-exported from `shared/usage.ts` |
| `usage/opencode-go.ts` | fetch `/zen/go/v1/usage`, map to three `UsageWindow`s, cache with a TTL (60 s), tolerate non-200 and non-JSON |
| `usage/cloudflare.ts` | the existing neurons/spend logic, moved and unchanged |
| `usage/state.ts` | JSONL append + today's totals, keyed by provider (generalise the existing file) |
| `usage/index.ts` | one status segment; `message_end` accounting; refresh timer; `/usage` command |
| `usage.config.json` | `{ refreshMinutes, showTokens, opencodeGo: { keyEnv, baseUrl } }` — **never the key itself** |

**Behaviour:**
- One status key, `usage`, cleared when the active model's provider has no reporter.
- The API key comes from `process.env.OPENCODE_API_KEY` or Pi's saved auth — **read, never logged, never written to config or the state file.**
- Refresh on a timer **and** on `model_select`. Skip the fetch entirely when opencode-go is not the active provider.
- Any failure renders as a short error suffix, not a crash and not a zero.

**Acceptance:** the opencode-go reporter maps the live payload to three windows and formats them;
a 404/500/timeout renders the error suffix while the token line still works; tokens accumulate across a session
restart; switching provider clears the segment; `print` mode does not throw.

---

## 7. Phase 3 — `workbench`

Three features. No ramp, no decorate.

| Feature | File | Spec |
|---|---|---|
| **pet** | `pet.ts` | `setWorkingIndicator({frames, intervalMs})` + `setWorkingMessage(verb)` + `setStatus`. Mood from context fill and recent tool errors. Rotate the 30 themed verbs (starwars/marvel/barca/auto) **per turn** — the capability gain over Claude's static list. `/pet` shows state, `/pet theme <t>` pins, `/pet badges` toggles. Restore defaults on `session_shutdown`. |
| **statusline** | `statusline.ts` | **Rewrite** — the current file is one minified line, and its `decorate`-style assumptions are gone. `ctx.ui.setFooter(factory)`; restore `undefined` on shutdown. Line 1: branch · ctx% · duration · cost. Line 2: provider usage windows from Phase 2. Verified available: `footer.getGitBranch()`, `footer.onBranchChange()`, `ctx.getContextUsage()`. **No ccusage, no lines-added** — say so rather than fabricate. `stats()` and `duration()` split out and tested. |
| **cockpit** | `cockpit.ts` | **Rewrite** as a right-anchored overlay. `/cockpit` toggles; `anchor:"right-center"`, `width:"38%"`, `maxHeight:"80%"`, `nonCapturing:true`, `visible:(w)=>w>=120`. Shows context %, cost, **provider usage windows**, live Fabric agents, recent Jev decisions from `shared/ledger.ts`. Recompute on `turn_end` + `tool_result`, not a blind interval. |

**Acceptance:** with `cockpit` off, a session shows a themed working line and a two-line footer. With all three
`false`, the extension loads and does nothing. In `print` mode nothing throws.

**Manual check (cannot be automated):** indicator animation, footer repaint on branch change, overlay placement and
its disappearance below 120 columns, theme switching, regular vs fullscreen.

---

## 8. Phase 4 — `duck`

`/duck <prompt>` puts the current plan in front of a model with an instruction to return **questions only**.

- Nested call via `ctx.modelRegistry.streamSimple(ctx.model, { messages })` — verified to typecheck on 1.2.0 with no cast. **No subprocess.**
- Show the nested call's `usage` (`input`/`output`) in the header. This is where nested-call accounting gets demonstrated.
- Right-anchored overlay like `cockpit`, or a widget when the rail is unavailable.
- `buildDuckPrompt(plan, question)` pure and tested.

---

## 9. Phase 5 — `jev` (and `decorate` comes back here)

Two repos, one feature.

**In `~/.claude/skills/jev-harness/`:**
- `core/types.ts` — add `"pi"` to `AgentId`. The **only** core change.
- `adapters/pi/index.ts` — `normalize` / `supports` / `render` / `neutral`, mirroring the Claude adapter (~90 l).
- `supports(verdict, ctx)` becomes **dynamic**: `ask` is expressible only when `ctx.hasUI`. Keep the static table as
  the default and add the predicate as an optional parameter, so Claude/Cursor/Antigravity behaviour cannot change —
  their 84 tests are the guard.
- Decision order per the review: shell-safety + shell-rules + repo-state + deploy-preflight → read-budget →
  mcp-trim → injection-screen → promise-continue + loop-detector → failure-triage + semantic-lint →
  outbound-leak + memory-hygiene → compact-advisor → subagent-router.

**In this repo:**
- `extensions/jev/index.ts` — subscribe `tool_call`, `tool_result`, `agent_before_settle`, `session_before_compact`; call `runEvent(...)` directly; apply `block` / `event.input` mutation / result replacement.
- Task context from `ctx.sessionManager.getBranch()` + `ctx.getContextUsage()`. Drop the `PI_SESSION_FILE` dependency.
- `decorate` returns here: a `tool_result` handler that classifies a Jev denial and toasts it once per `toolCallId`. `toolCallId` is on both event bases — verified.
- Delete `lib/bridge.ts`. Declare the harness surface as a local type; do not import by absolute path.

---

## 10. Testing strategy

- **Pure logic unit-tested:** config precedence, state reduction, usage mapping (fixture JSON → windows), CSP-style formatting, duration/stat helpers, mood selection, verb rotation, duck prompt assembly, ledger parsing, denial classification.
- **Interactive behaviour gets a written manual checklist** in each extension's doc. We are in print mode; no TUI assertion is a real assertion. Nine behaviours need a human: indicator, footer repaint, overlay placement, overlay hidden <120 cols, widget placement, theme change, regular vs fullscreen, duck widget, and the usage segment appearing/clearing on model switch.
- `bun test tests` per the repo; keep `utilities.test.ts` and `tests/fabric/` intact.

---

## 11. Non-goals

- **No `gate`, no `ramp`, no `decorate`** in this pass (see §2 for why and when they return).
- **No persistent right dock.** `WidgetPlacement` is only `aboveEditor | belowEditor`; an overlay lives only as long as its `ctx.ui.custom()` promise. The right rail is toggled, not docked.
- **No cost figure for opencode-go.** Its API exposes no spend and its model list has no pricing. Percent + tokens + reset times only.
- **No quota windows for Cloudflare Workers AI** — no such endpoint was found; it reports neurons and MTD USD instead. *(Corrected from revision 1, which wrongly said quotas were unavailable to the whole pack.)*
- **No ccusage**, no lines-added/removed — Claude-specific or not exposed.
- **No bridge, no `execFile`, no `sqlite3`.**
- **No re-implementation of Jev** — the adapter maps, the engine decides.
- **No touching** `fabric/`, `project-context.ts`, `recursive-context.ts`, `cloudflare-ai-usage.ts`, `sanitize-skill-names.ts`.

---

## 12. Risks and open questions

| Risk | Mitigation |
|---|---|
| `/zen/go/v1/usage` is **undocumented and unversioned** — it is not in OpenCode's published API surface as far as I can tell. It could change shape or vanish. | Isolate it in `usage/opencode-go.ts` behind the `UsageWindow` mapping; any parse failure renders an error suffix and leaves the token line working. Add a test with the exact live payload as a fixture so a shape change fails loudly. |
| The key is read from `auth.json` or the environment. | Read-only, never logged, never written to the state file or config. The reporter sends it to exactly one host. |
| `nonCapturing` overlays may not behave for a panel kept open while typing. | Best-effort: if it steals input, fall back to `setWidget` rather than fighting it. Decide after one manual run. |
| Making `supports()` dynamic in jev touches a contract three adapters rely on. | Optional parameter; static table stays the default; their test suite is the guard. |
| Feature flags mean three codepaths in one entry. | Each feature in its own `try`; failure reported once via `notify` at `session_start`. |
| **Open:** does Pi expose a per-turn token/cost aggregate to extensions? | Unresolved. Cost is a running sum we compute from assistant-message usage. If a real aggregate exists, `statusline.stats()` and `usage/state.ts` are the only things that change. |
| **Open:** does `read-budget` mutate `event.input` or block? | Mutating is the plan. Unknown whether Pi re-validates arguments after a `tool_call` handler. One experiment before Phase 5. |

---

## 13. Sequencing

```
Phase 0  blockers ──→ Phase 1 shared ─┬─→ Phase 2 usage ──→ Phase 3 workbench ──┐
                                      │                                        ├─→ done
                                      └─→ Phase 4 duck ───────────────────────┘
                                      └─→ Phase 5 jev (separate repo; needs only shared/ledger for the cockpit)
```

`usage` before `workbench` because `statusline` and `cockpit` both render its output. `duck` shares nothing but
`shared/` and can run in parallel with `usage`. `jev` is independent and largest.

**First three commits:** Phase 0.1 (`check-package.mjs`) → Phase 1 (`shared/` + tests) → Phase 2.3 (`usage/opencode-go.ts`
with the live-payload fixture).
