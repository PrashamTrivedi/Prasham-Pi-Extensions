# Spec C — session observability (I4.1–I4.3)

Parent: `taskNotes/pi-mods-workbench/taskFindings.md`.

## Purpose

The three plan-2 observability items: MCP/Jaal tool renderer, `/context` budget
breakdown, and the session ledger write side with `/report`.

## Original Ask

- I4.1 `registerToolRenderer` for `mcp__*` names (display only).
- I4.2 `/context` breakdown (project tree, nested `AGENTS.md` by file, skills, MCP
  schemas) from `getContextUsage` + known injector limits.
- I4.3 append-only session ledger (Node `fs`) written on `tool_execution_start/end`,
  `message_end` usage, and fabric spawn/cancel; `/report`; two read-only endpoints
  on the existing `ledger-server.ts`.

## Complexity

**4 / 5.** New persistent ledger + renderer + a cross-cutting read endpoint.

## Backend changes required

- `workbench/mcp-renderer.ts` — `registerToolRenderer((name, next) => ...)`:
  format `mcp__*` JSON results; `next() ?? mine`.
- `workbench/context.ts` — `/context`: report `getContextUsage()` and the known
  injector ceilings (`project-context` ≤ 8,000 chars; `recursive-context`
  ≤ `PI_RECURSIVE_CONTEXT_MAX`, default 200,000) without inventing numbers.
- `workbench/report.ts` — append to `~/.pi/agent/state/session.jsonl`
  (`{ ts, kind, tool?, latencyMs?, input?, output?, usd?, model?, agent? }`);
  `/report` summarizes; never throws on read.
- `extensions/shared/ledger-server.ts` — add read-only endpoints
  `/session-calls?limit=N` and `/session-summary` over the session JSONL.
- `extensions/shared/ledger.ts` — add `sessionCalls`/`sessionSummary` clients.

## Acceptance Criteria

1. An `mcp__*` tool result renders as a table/diff; non-MCP names fall through.
2. `/context` shows current usage and the injector ceilings; no fabricated values.
3. Session ledger appends one record per event and is excluded from model context;
   `/report` summarizes; missing file → empty, no throw.
4. `ledger-server` serves the two new session endpoints; the client degrades to
   `{rows:[],error}` when absent.
5. No `bun:sqlite`/`node:sqlite` in `workbench/**`.

## Validation

```sh
bun test tests/workbench
bun run extensions/shared/ledger-server.ts &   # /report against a session
pi -ne -e ./extensions/workbench/index.ts
```
