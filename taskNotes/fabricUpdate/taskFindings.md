# Fabric update — findings

Status: feasibility spike settled. Fabric is **surgical changes, not a total rewrite** —
the existing subprocess execution engine stays for now; the SDK is adopted for model
selection.

## Decision

- **In-process SDK subagents are feasible** (proven below), but we do **not** rewrite
  Fabric onto them now. The current `pi`-subprocess execution (isolated worktree per
  agent) already mirrors Pi's official `subagent` example and gives hard isolation +
  OS-level parallelism.
- "SDK under the hood" is satisfied where it matters: **model resolution/routing uses
  the SDK** (`ctx.modelRegistry` + optional Jev `classify()`), replacing the hand-rolled
  rank-map string matching.
- Orchestrator (this agent) stays on a strong model; subagents run on lower models
  (mostly `flash`).

## Spike — in-process SDK feasibility (settled)

Script (throwaway, `/tmp/pi-sdk-subagent-spike.ts`) drove `createAgentSession()` with
`SessionManager.inMemory()`, `thinkingLevel: "low"`, per-agent `model`, three probes:

| Probe | Result |
|---|---|
| 3 sessions in parallel (`Promise.all`) | all completed correctly (`ALPHA`/`BRAVO`/`CHARLIE`), wall **5508ms** |
| same 3 tasks serial | wall **8299ms** (sum of 1331+2930+4038ms) |
| read-only agent, custom `cwd`, `read` tool | read `package.json` → `"prasham-pi-extensions"` |

**Conclusions**

- Concurrency is **real, not serialized**: parallel wall (5.5s) ≈ longest single agent
  (5.5s) and span (first start → last end 5.5s). Serial wall (8.3s) = the sum.
- `createAgentSession` gives each agent its own `cwd`, tool allowlist, and isolated
  in-memory context — a true full agent loop in one process.
- `ModelRuntime.getAvailable()` enumerates a large authenticated catalog
  (`openai/gpt-*`, `google/gemini-*`, `cloudflare-ai-gateway/...`, `opencode-go/...`) —
  the authoritative source for "any model Pi knows".
- Caveat: the probe picked `cloudflare-ai-gateway/.../deepseek-v4-flash-0731` (first
  flash match) instead of `opencode-go/deepseek-v4.1-flash`. Model selection must be
  **explicit by provider/id**, never substring.

## Model selection semantics (agreed)

For `spawn_agents`:

1. **Explicit `model` param wins** — validated against `ctx.modelRegistry.getAll()`.
2. **Not specified** → hierarchy + current model decides the default; the current model
   is allowed even if it is outside the hierarchy (never blocks).
3. **Optional Jev routing** — `ctx.modelRegistry.classify("typesafe", "jev-latest", …)`
   over the hierarchy's `description` strings to pick a model from the config.

## Surgical changes (the Fabric plan)

1. **Replace the rank gate** — delete `modelRule` / `effectiveRule` / `requestedRule`;
   add one `authorizeModel(config, caller, requested, registry)`. Default **open**
   (any catalog model), hierarchy used only to choose the *default* when unspecified.
2. **`list_models` tool** — expose `ctx.modelRegistry.getAll()` / `getAvailable()` to
   the agent so it can pick models explicitly.
3. **Governance (optional, default off)** — `policy`: `allow`/`deny` globs over
   `provider/id`, catalog-price ceiling, `maxAgentsPerRoot` recursion guard.
4. **Modes** — `fabric_council` (parallel members + optional moderator rounds) and
   `fabric_competition` (N agents, same task, N-way compare + optional judge) as thin
   orchestrators over extracted `enqueueAgents()` / `waitForAgents()`, reusing the
   existing comparison cards and `/team` inspector.
5. **Bugfix** — `cancel_agents` / `await_agents` / `agent_status` / `/team cancel` only
   accept the **full UUID**, while the UI and spawn result show short ids (`17bdfd`).
   Resolve short ids too.

## Deferred / follow-ups

- Full in-process SDK execution tier (proven feasible; keep subprocess for parallel
  modes for now).
- Nested-in-tool-call smoke test (a subagent spawned from inside a parent tool call) —
  only observable inside a live Pi session.
- Recursion safety & cost accounting (price ceiling is not a spend budget).

---

*This note supersedes the Fabric item in `taskNotes/next-session/taskFindings.md`.*
