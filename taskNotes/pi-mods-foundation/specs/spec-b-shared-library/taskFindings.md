# Spec B — `shared/` library

Parent: `taskNotes/pi-mods-foundation/taskFindings.md`
Source: `docs/pi-mods-plan.md` §5.

## Purpose

Create the imported library every later pi-mods extension depends on: layered
config, branch-scoped state, the shared usage contract, and a ledger reader built
as a **local Bun server** plus a Node-safe HTTP client.

## Original Ask

Add `extensions/shared/{config,state,usage,ledger,ledger-server,index}.ts` with
unit tests. It is imported, never registered as a manifest entry. Degrade safely on
a missing config, missing ledger, and out-of-range numbers. No subprocess from the
extension, and no SQLite binding inside the Node extension graph.

## Complexity and the reason behind it

**4 / 5.** Pure logic, but a contract-bearing library plus a split service/client
design forced by the Pi=Node / tests=Bun runtime mismatch. Nothing here renders, so
tests fully cover it.

## Architectural changes required

- `shared/` is a barrel library, not an extension entry point.
- **Ledger is out-of-process.** `ledger-server.ts` (Bun-only) holds `bun:sqlite`
  and serves JSON on `127.0.0.1`; `ledger.ts` (Node-safe) is a fetch client. The
  server must **never** be re-exported from `shared/index.ts`, so no
  `bun:sqlite`/`node:sqlite` import can reach the Pi runtime.
- Config precedence, lowest→highest: extension-dir defaults → agent dir → cwd →
  cwd/.pi.

## Backend changes required

- `shared/config.ts` — `loadConfig(name, { cwd, agentDir, extensionDir })` →
  `{ config, sources, errors }`; `objectValidator`; guards `isString`,
  `isFiniteNumber`, `isBoolean`, `isStringArray`; `clamp(value, min, max)`. Missing
  files skip; malformed JSON is pushed to `errors[]` and ignored (defaults win).
- `shared/state.ts` — `BranchState`, `stateFromBranch(entries)` (active branch
  only; tolerance for `null`/junk entries as in `extensions/sandbox-dev/state.ts`),
  plus branch-scoped append/read helpers for `pi.appendEntry`. Model-invisible.
- `shared/usage.ts` — exported types:
  ```ts
  export type UsageWindow = { label: string; percent: number | null; resetsAt?: string };
  export type ProviderUsage = {
    provider: string; windows: UsageWindow[];
    tokensToday?: { input: number; output: number };
    usdMtd?: number; note?: string; error?: string;
  };
  export function formatUsage(usage: ProviderUsage): string;
  ```
  `formatUsage` renders percent windows and USD/token figures and never invents a
  value for a `null` percent.
- `shared/ledger-server.ts` — **Bun-only**:
  `createLedgerHandler({ dbPath })` returns a pure
  `(request: Request) => Promise<Response>` handler for
  `/recent-calls?limit=N` and `/decision-counts`, backed by a read-only
  `bun:sqlite` `Database`. A `Bun.serve` bootstrap runs under
  `if (import.meta.main)`, listening on `PI_JEV_LEDGER_PORT` (default `37650`).
  Missing/unreadable db → JSON `{ error }` with HTTP 500, no crash. **Read-only;
  never writes.**
- `shared/ledger.ts` — **Node-safe client**: `recentCalls(limit)` and
  `decisionCounts()` fetch `PI_JEV_LEDGER_URL` (default
  `http://127.0.0.1:37650`), with an injectable `fetchImpl` and
  `AbortSignal.timeout(2000)`. Returns `{ rows, error }`; any failure (refused,
  timeout, non-200, bad JSON) is an `error`, never a throw. No sqlite import.
- `shared/index.ts` — barrel re-exporting config, state, usage, and the **ledger
  client** only.

## Frontend changes required

None.

## Acceptance Criteria

1. Config precedence: a valid cwd/.pi file overrides agent-dir and cwd files;
   malformed JSON yields defaults plus a non-empty `errors[]`; missing files throw
   nothing.
2. `clamp` and the guards behave for boundary inputs (NaN, negative, oversized).
3. `stateFromBranch` ignores entries from abandoned sibling branches.
4. `formatUsage` handles a percent-only provider, a USD-only provider, and an
   error provider without fabricating values.
5. `ledger-server.ts` handler returns rows for a fixture db and a JSON error (not
   a crash) for a missing db; `ledger.ts` returns those rows over HTTP and
   `{ rows: [], error }` when the server is absent or errors.
6. The extension import graph contains no `bun:sqlite` / `node:sqlite` reference;
   only `ledger-server.ts` (Bun-run) imports `bun:sqlite`.
7. No `as any` / `as unknown as`; no `child_process` / `execFile`.

## Validation

```sh
bun test tests/shared        # 0 fail
npm run typecheck
grep -rn "bun:sqlite\|node:sqlite" extensions --include=*.ts   # only ledger-server.ts
```

Server check (Bun) against the real 25 MB ledger:

```sh
bun run extensions/shared/ledger-server.ts &
curl -s "http://127.0.0.1:37650/decision-counts"
kill %1
```

Tests:

- `config.test.ts` — precedence, malformed JSON, guards, clamp.
- `state.test.ts` — abandoned-branch exclusion, junk-entry tolerance.
- `usage.test.ts` — three provider shapes through `formatUsage`.
- `ledger-server.test.ts` — handler returns rows for a test-created fixture db;
  missing db → JSON error; **must not** require a live Pi session.
- `ledger.test.ts` — missing server → `{rows:[],error}`; injected `fetchImpl` →
  rows; non-200 and bad JSON → `error`, no throw.
