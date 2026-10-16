# Purpose

Land the foundation of the **pi-mods** extension pack: harden the package
checker, build the shared `extensions/shared/` library with tests, and prove the
provider-usage path with the `opencode-go` reporter and its verified live payload
as a fixture. This is the first three commits named in `docs/pi-mods-plan.md` §13.

## Original Ask

User's words (verbatim from the session):

> "We are working on some extensions. What are they? and where are we with it?"
> "Let's plan for it now"

Parsed, scoped requirement for this run — the **foundation increment** of the
pi-mods pack (the pack's own recommended first three commits):

1. Make `scripts/check-package.mjs` robust to a variable number of extension
   entries so adding extensions no longer requires editing the checker.
2. Add the shared library `extensions/shared/` — `config.ts`, `state.ts`,
   `usage.ts`, `ledger.ts`, `index.ts` — with unit tests, imported by later
   extensions and **not** listed as a manifest entry.
3. Add `extensions/usage/opencode-go.ts`: map the verified
   `GET https://opencode.ai/zen/go/v1/usage` payload to three usage windows,
   with the live payload committed as a fixture and tests.

Scope is bounded to the **foundation**. The later phases (`usage/index.ts`,
`workbench`, `duck`, `jev`) are recorded under *Deferred follow-ups* and are
**not** part of this run's outcome.

## Findings from investigation (why the scope is drawn here)

- **`docs/pi-mods-plan.md` and `docs/pi-mods-review.md` already contain the full
  design.** This plan does not re-derive it; it converts the first increment into
  an actionable, testable task and records verification evidence.
- **The four subagent worktrees are gone.** Branches `mods/{gate,jev,pack,tui}`
  all point at `2ec2a7e` with empty diffs; `/tmp/pi-mods-lab/` no longer exists.
  `git stash`/`git fsck` show nothing recoverable. Their code must be rewritten
  from the surviving docs; **nothing can be cherry-picked.**
- **Pi runs under Node, not Bun; the test runner is Bun.** The `pi` launcher is
  `#!/usr/bin/env node` (`dist/bundle/cli.js`), so extensions execute under Node
  22.x, while `bun test` executes tests under Bun 1.3.10. Consequence for SQLite:
  - `bun:sqlite` works under the test runner but **fails inside Pi**
    (`ERR_UNSUPPORTED_ESM_URL_SCHEME`); `node:sqlite` works under Node but
    **fails under Bun** (`No such built-in module`).
  - So do **not** embed a SQLite binding in the extension. **Human directive (this
    review):** read the ledger from a **local Bun-run server**, not an in-process
    binding. `bun:sqlite` lives only inside that server; the Pi-side extension is
    a plain HTTP client. This supersedes the pack's "zero subprocesses" note
    **for the ledger only**.
  - This also corrects the review's "`bun:sqlite` verified working in-process"
    note, which was evidently verified under Bun rather than the Pi runtime.
- **`~/.jev-harness/jev.db` exists** (25 MB). The ledger reader has a real target.
- **Installed and pinned Pi are both 1.2.0** in the working tree (`package.json`
  uncommitted change). `node_modules` resolves 1.2.0. The version-skew defect is
  fixed; keep it fixed.
- **The working tree already contains uncommitted sandbox-dev work**
  (`extensions/sandbox-dev/`, `tests/sandbox-dev/`, `prompts/`, `skills/`,
  `examples/sandbox-dev.json`, and README/CHANGELOG/check-package edits). This is
  the skill-harness baseline, unrelated to pi-mods. It is a dirty-tree hazard and
  must be resolved before the completion commit (see Spec A).
- **Working `check-package.mjs` already asserts `length == 6`** (baseline + the
  new sandbox-dev entry); `HEAD` asserts `5`. Spec A removes the count entirely.
- **`extensions/sandbox-dev/config.ts` already implements a global→project config
  loader.** `shared/config.ts` generalises the same pattern; sandbox-dev is
  **not** refactored in this run (non-goal), to keep the diff scoped.

## Complexity and the reason behind it

**Complexity: 4 / 5.**

- Greenfield pure-logic modules with direct unit tests (raises confidence, caps
  risk below 5).
- But it creates a **contract-bearing shared library** that every later phase
  imports, so naming/types must be right the first time.
- Adds a read-only ledger **server** plus a Node-side HTTP client (resolving the
  Pi=Node vs tests=Bun runtime mismatch) — the riskiest item.
- Deliberately wires **nothing live**: no extension entry is registered, so there
  is no end-to-end/interactive proof in this increment, only unit + manifest
  checks. That is intentional (the pack's own ordering) but it means "works in a
  Pi session" is deferred to the next increment.

## Architectural changes required

- **Introduce `extensions/shared/` as an imported library.** It is a barrel
  (`index.ts`) plus focused modules. It is **never** added to `pi.extensions`.
- **Ledger as a local Bun service.** `shared/ledger-server.ts` is a Bun-only
  module that opens `~/.jev-harness/jev.db` **read-only** with `bun:sqlite` and
  serves JSON over `127.0.0.1` (`Bun.serve`); it is run with Bun and is **never**
  imported by the Node extension graph. `shared/ledger.ts` is a Node-safe HTTP
  client (no sqlite import) that reads `PI_JEV_LEDGER_URL` (default
  `http://127.0.0.1:37650`) with an injectable `fetchImpl` and a short timeout.
  Server lifecycle (auto-start / port / shutdown) is **deferred** to the
  workbench phase; this increment ships the runnable server, the client, and
  tests.
- **Layered config loader.** `shared/config.ts` resolves, lowest→highest
  precedence: extension-dir defaults → `$PI_CODING_AGENT_DIR` (default
  `~/.pi/agent`) → `<cwd>` → `<cwd>/.pi`. Malformed files are reported and
  skipped, never fatal.
- **Usage contract.** One `ProviderUsage` type covers both providers:
  opencode-go contributes `windows` (percent + reset), Cloudflare contributes
  `usdMtd`/token totals. `formatUsage()` renders both through one function.
- **No new manifest entries.** `pi.extensions` stays at its current 6 entries
  (5 shipped + sandbox-dev); the checker no longer hardcodes that number.
- **No subprocesses except the authorized ledger server; no network in tests.**
  The pack's locked decision #1 (in-process native) holds for everything except
  the Jev ledger, per the human directive above. All HTTP in tests uses injected
  `fetchImpl`s, never the real network.

## Backend changes required

(All logic here is "backend"; this repo has no web server.)

1. `scripts/check-package.mjs` (modify):
   - Remove `assert.equal(pkg.pi.extensions.length, N)`.
   - Keep: repository URL, each entry exists, helper files not listed.
   - Add: each listed entry's source contains a default export (read the file and
     match `/export\s+default/`; a `.ts` entry cannot be `import`ed under Node).
   - Pass for any entry count from 4 to 12.
2. `extensions/shared/config.ts` (new): `loadConfig(name, { cwd, agentDir,
   extensionDir })` returning `{ config, sources, errors }`; `objectValidator` +
   primitive guards (`string`, `finiteNumber`, `boolean`, `arrayOf`); numeric
   `clamp(value, min, max)`. Invalid JSON → defaults + `errors[]`.
3. `extensions/shared/state.ts` (new): `BranchState`, `stateFromBranch(entries)`,
   and append/read helpers. Branch-scoped: reconstruct only the active branch;
   ignore abandoned sibling entries. Persisted via `pi.appendEntry` and **excluded
   from model context.** Mirror the entry-tolerance style of
   `extensions/sandbox-dev/state.ts`.
4. `extensions/shared/usage.ts` (new): the `UsageWindow` and `ProviderUsage`
   types from `docs/pi-mods-plan.md` §5, plus `formatUsage(usage, width?)`.
5. `extensions/shared/ledger-server.ts` (new, **Bun-only**):
   `createLedgerHandler({ dbPath })` → a pure `(request) => Promise<Response>`
   handler for `/recent-calls?limit=N` and `/decision-counts`, backed by a
   read-only `bun:sqlite` `Database`; plus a `Bun.serve` bootstrap in
   `if (import.meta.main)` so it runs via
   `bun run extensions/shared/ledger-server.ts`. Read-only; **never writes**; a
   missing db yields a JSON error body, not a crash. **Excluded from the
   `shared/index.ts` barrel** so `bun:sqlite` never enters the Node extension.
6. `extensions/shared/ledger.ts` (new, Node-safe client): `recentCalls(limit)`
   and `decisionCounts()` calling the server over HTTP at `PI_JEV_LEDGER_URL`
   (default `http://127.0.0.1:37650`), with an injectable `fetchImpl`,
   `AbortSignal.timeout(2000)`, and **no sqlite import**. Any failure (connection
   refused, timeout, non-200, bad JSON) → `{ rows: [], error }`, never throws.
7. `extensions/shared/index.ts` (new): barrel re-exporting config, state, usage,
   and the ledger **client** (not the server).
8. `extensions/usage/opencode-go.ts` (new): `fetchOpencodeGoUsage({ keyEnv,
   baseUrl, fetchImpl })` → `ProviderUsage`. Sends exactly one host
   (`https://opencode.ai`), reads the key from `process.env.OPENCODE_API_KEY`
   **only** (never logs or persists it), TTL-caches 60 s, and maps
   `rolling`/`weekly`/`monthly` to three `UsageWindow`s. Non-200, non-JSON, and
   timeout each return a `ProviderUsage` with `error` set — never throw.
9. Tests (new): `tests/shared/config.test.ts`, `tests/shared/state.test.ts`,
   `tests/shared/usage.test.ts`, `tests/shared/ledger.test.ts`,
   `tests/shared/ledger-server.test.ts`, `tests/usage/opencode-go.test.ts`, plus
   `tests/fixtures/opencode-go-usage.json` (the exact verified live payload).

## Frontend changes required

**None in this increment.** No extension entry is registered, so no TUI code
(statusline, cockpit, widget, footer) is added or changed. Rendering is deferred
to the `workbench` phase. `formatUsage()` is pure string logic and is unit-tested,
not rendered.

## Acceptance Criteria

For complexity >= 3, explicit criteria:

1. `node scripts/check-package.mjs` exits 0 and contains **no numeric extension
   count**; it validates every listed entry exists, is not a helper, and has a
   default export. Adding a 7th/8th entry requires no edit to the script.
2. `extensions/shared/config.ts` resolves the documented precedence; a
   higher-precedence valid file overrides a lower one; invalid JSON falls back to
   defaults **and** reports the file in `errors[]`; it never throws.
3. `extensions/shared/state.ts` reconstructs state from a branch only, ignoring
   abandoned sibling entries, and exposes the current task/outcome fields without
   adding anything to model-visible context.
4. `extensions/shared/usage.ts` exports `UsageWindow` and `ProviderUsage` and a
   `formatUsage()` that renders percent windows and USD/neuron figures without
   fabricating missing values.
5. `shared/ledger-server.ts` (Bun) serves read-only `recent-calls` and
   `decision-counts` for a fixture db; `shared/ledger.ts` (Node-safe, no sqlite
   import) returns the same rows over HTTP and `{ rows: [], error }` (no throw)
   when the server is absent or errors. The Node extension import graph contains
   **no** `bun:sqlite` / `node:sqlite` reference.
6. `extensions/usage/opencode-go.ts` maps `tests/fixtures/opencode-go-usage.json`
   to exactly three `UsageWindow`s with the expected percents and reset times;
   non-200 / non-JSON / timeout produce `error` set and no windows, without
   throwing. It sends the key to no host except the configured `baseUrl`.
7. `npm run check` exits 0: typecheck clean, full test suite 0 failures, manifest
   validated. New or changed tests cover criteria 2–6.
8. No `as any` / `as unknown as`, no `child_process` / `execFile` / `pi.exec`, and
   no network call in the test suite. (Pre-existing `fabric/index.ts:149` is
   grandfathered; nothing new is exempt.)

## Validation

Commands (run from the repo root; every command's exit code is echoed):

```sh
npm run check            # typecheck + bun test + manifest validation
bun test tests           # suite summary line must show 0 fail
node scripts/check-package.mjs
```

What to verify:

- **Checker (AC1):** temporarily append a bogus entry to `pi.extensions` → the
  script fails with "Missing entry point"; temporarily strip `export default`
  from a fixture entry → fails with "no default export"; restore. Confirm no
  numeric count remains.
- **Config (AC2):** fixture dirs prove precedence and that bad JSON is reported,
  not fatal.
- **State (AC3):** a branch with an abandoned sibling entry yields only the active
  branch's state.
- **Usage types (AC4):** `formatUsage` output for a percent-only provider, a
  USD-only provider, and an error provider.
- **Ledger (AC5):** (a) no server running → `{ rows: [], error }`, no throw;
  (b) fixture db → start `bun run extensions/shared/ledger-server.ts` and confirm
  `curl -s http://127.0.0.1:37650/decision-counts` returns JSON; (c) unit tests
  drive the handler under Bun against a test-created fixture db and the client
  with an injected `fetchImpl`; (d) grep the extension graph to prove no
  `bun:sqlite` / `node:sqlite` import exists outside `ledger-server.ts`.
- **opencode-go (AC6):** the fixture test must assert three windows and the exact
  percents; a mocked failing `fetchImpl` must yield `error` and no throw. No live
  network in tests.

Manual check (cannot be automated here): none required — no TUI surface is added
in this increment. Interactive rendering is explicitly deferred.

## Deferred follow-ups (explicitly outside this run's outcome)

Recorded so the scope line is unambiguous; each needs its own plan/approval:

- **Phase 2 remainder** — `usage/index.ts` (status segment, `message_end`
  accounting, refresh timer, `/usage`), `usage/cloudflare.ts` (port of
  `cloudflare-ai-usage.ts`), `usage/state.ts`, `usage.config.json`; then retire
  `cloudflare-ai-usage.ts`.
- **Phase 3 `workbench`** — `pet`, `statusline` rewrite, `cockpit` (right-anchored
  overlay, consumes `shared/ledger.ts`), **including ledger-server lifecycle**
  (auto-start, port selection, health check, shutdown).
- **Phase 4 `duck`** — `/duck` via `ctx.modelRegistry.streamSimple`.
- **Phase 5 `jev`** — native adapter + `decorate`, and the `AgentId | "pi"` change
  in `~/.claude/skills/jev-harness/`.
- **Deferred by design** — `gate`, `ramp` (and `decorate` until `jev`).
- **Newly surfaced open question** — should `extensions/sandbox-dev/config.ts` be
  refactored onto `shared/config.ts`? Deferred; not touched here.

## Specs

Breakdown lives in `specs/specs.md` with one plan per spec:

- `specs/spec-a-package-check/taskFindings.md`
- `specs/spec-b-shared-library/taskFindings.md`
- `specs/spec-c-opencode-go/taskFindings.md`
