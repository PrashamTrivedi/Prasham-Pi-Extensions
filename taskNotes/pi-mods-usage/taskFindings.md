# Purpose

Register a **simple, per-provider** usage extension for **opencode-go limits**
(rolling / weekly / monthly), loadable and testable in this directory. Cloudflare
keeps its own existing extension — **no cross-provider merge**.

## Original Ask

User's words (verbatim from the session):

> "Ran `pi -ne -e ./pi-mods-selftest.ts` … Error: Failed to load extension … Extension
> path does not exist"
> "I need to test it somewhere, with Pi.... The script doesn't matter to me that
> much without the pi extension."
> "Here is the plan. Let's enable these customisations here. In this directory"

Approval feedback (verbatim):

> "Do not drop anything. And use the env key. Fail on user's face if something not
> found."
> "I don't understand the increase complexity. Is it because you have to show two
> usage? Then let's make it simpler, per provider limits not everything together."
> "And I haven't seen anything about cockpit, pet or any other things apart from
> usage. Are they being developed or dropped?"
> "go go go"  *(approval intent — awaiting the gate's literal `g`)*

Scoped outcome for this run:

1. Add `extensions/usage/index.ts` — a registered extension that shows the
   **active opencode-go** quota limits (rolling / weekly / monthly) in one `usage`
   status segment, plus a `/usage` command to refresh. Nothing cross-provider.
2. Add `extensions/usage/config.ts` — a small config (`refreshMinutes`,
   `opencodeGo: { keyEnv, baseUrl }`) via `shared/config.ts`. Config **names**
   env vars; it never holds a key.
3. Reuse the built `extensions/usage/opencode-go.ts` reporter and
   `shared/usage.ts` `formatUsage`.
4. Register `./extensions/usage/index.ts` in `pi.extensions`.
5. **Drop nothing:** `cloudflare-ai-usage.ts` is untouched and still registered;
   it remains Cloudflare's own display. No unified `ProviderUsage` merge across
   providers — each provider shows its own limits.
6. **Reuse Pi's own auth; fail visibly:** resolve the opencode-go key from Pi's
   provider auth (`ctx.modelRegistry.getApiKeyForProvider("opencode-go")`) — the same
   credential Pi uses to run the model — with the configured env var as a fallback.
   Never store or log it. A genuinely missing key or a failed API call is shown to
   the user, never silently swallowed.

### Why the complexity dropped from the previous revision

The earlier revision merged opencode-go and Cloudflare behind one `ProviderUsage`,
which forced a **second, overlapping usage surface** alongside the retained
`cloudflare-ai-usage.ts`. Per the feedback, this increment is **per provider**:
one reporter, one status segment, one provider. No merge, no overlap, no
Cloudflare port here.

### The key is already available from Pi

Verified in installed 1.2.0: `ExtensionContext.modelRegistry: ModelRegistry` exposes
`getApiKeyForProvider(provider): Promise<string | undefined>` and
`hasConfiguredAuth(model): boolean`. That is how Pi authenticates the model, so
requiring a separate `OPENCODE_API_KEY` was wrong. The extension resolves the key
from `getApiKeyForProvider("opencode-go")` first, then the configured env var — so
the `env -u` test below **still works**, which is the demonstration that Pi's auth
is being reused.

## Nothing is dropped — full roadmap

Every customisation from the plan docs is tracked. "Deferred" = later increment,
never cancelled.

| Feature | Increment | Status | Source |
|---|---|---|---|
| Fabric (shipped) | — | built | `extensions/fabric/` |
| `shared/` + opencode-go reporter | 1 | **built, pushed** | `plan.md` §5–6 |
| **opencode-go `usage` + `/usage`** | **3** | **this plan** | `plan-2` I3 (simplified) |
| `/skills doctor` | 2 | planned (I2.1 already resolved) | `plan-2` I2.2 |
| **pet** (indicator, verbs, `/pet`) | 4 | planned | `plan.md` §7, `temp/workbench.md` |
| **statusline** (footer rewrite) | 4 | planned | `plan.md` §7 |
| **cockpit** (right overlay) + ledger-server lifecycle | 4 | planned | `plan.md` §7, `plan-2` I4 |
| MCP result renderer | 4 | planned | `plan-2` I4.1 |
| `/context` budget breakdown | 4 | planned | `plan-2` I4.2 |
| session ledger write side + `/report` | 4 | planned | `plan-2` I4.3 |
| **duck** (`/duck` second opinion) | **4b** | planned — **plan-2 omission, now slotted** | `plan.md` Phase 4 |
| **jev** native adapter + `decorate` | 5 | planned | `plan.md` §9, `plan-2` I5.1 |
| model router / MCP exposure / nested classification / provider interception / `/handoff` | 6 | planned | `plan-2` I6.1–I6.5 |
| fabric forensics + `/team gc`, herdr parity | 7 | planned | `plan-2` I7.1–I7.2 |
| **gate**, **ramp** | — | **deferred by explicit decision** (not dropped) | `plan.md` §2 |
| Cloudflare port into a shared shape; opencode-go local token accounting | later | deferred (tracked) | `plan.md` §6.3 |

**Duck note:** `plan-2`'s increment table never lists duck; only a passing mention
under I6.3. That is how a feature gets silently skipped, so it now has an explicit
slot (4b) after workbench.

## Complexity and the reason behind it

**Complexity: 2 / 5.**

- One provider, one reporter already built, one status segment, one command.
- No cross-provider merge, no second overlapping surface, no Cloudflare port.
- The only non-trivial parts are the Pi lifecycle wiring and the manual TUI check.
- Acceptance is complete satisfaction of `Original Ask` (no separate spec breakdown).

## Architectural changes required

- `extensions/usage/` becomes a second registered entry; `cloudflare-ai-usage.ts`
  is **unchanged and retained**.
- One status key, `usage`, set while `ctx.model.provider === "opencode-go"`;
  cleared otherwise.
- Config via `shared/config.ts` (`loadConfig("usage", …)`); env-var **names** only.
- **Key resolution:** `ctx.modelRegistry.getApiKeyForProvider("opencode-go")` →
  configured env var. Passed to the reporter in memory only.
- No new state file, no `message_end` accounting (deferred — see roadmap).

## Backend changes required

1. `extensions/usage/index.ts` (new): default export `usage(pi: ExtensionAPI)`.
   - `session_start`: load config; if `opencode-go` is active, refresh.
   - `model_select`: refresh when `event.model.provider === "opencode-go"`;
     otherwise clear the `usage` segment.
   - **key:** `const key = (await ctx.modelRegistry.getApiKeyForProvider("opencode-go")) ?? process.env[keyEnv]`;
     only if both are absent does it fail visibly
     (`notify("opencode-go has no configured auth", "error")`).
   - timer: refresh every `refreshMinutes`.
   - `registerCommand("usage", …)`: force refresh; on failure
     `notify(<reason>, "error")`.
   - `session_shutdown`: clear the timer.
   - Every `ctx.ui.*` call guarded by `ctx.mode === "tui" || ctx.mode === "rpc"`.
   - Renders with `formatUsage(await fetchOpencodeGoUsage({ apiKey: key, baseUrl }))`.
2. `extensions/usage/opencode-go.ts` (modify, small): accept an explicit
   `apiKey?: string` option, used instead of the env lookup when provided; env
   lookup stays the default for existing callers/tests.
3. `extensions/usage/config.ts` (new): `DEFAULT_USAGE_CONFIG`,
   `validateUsageConfig` (via `shared/config.ts` guards), and
   `loadUsageConfig({ cwd, agentDir, extensionDir })`.
   Shape: `{ refreshMinutes: number, opencodeGo: { keyEnv: string, baseUrl: string } }`.
4. `examples/usage.config.json` (new): illustrative; env var **names** only.
5. `package.json` (modify): **add** `./extensions/usage/index.ts`. Keep
   `./extensions/cloudflare-ai-usage.ts` (no removal).
6. Tests: `tests/usage/config.test.ts`, a small `tests/usage/entry.test.ts`
   (pure helpers: `shouldReport(provider)`, `statusText(usage)`), and an
   `opencode-go.test.ts` case for an injected `apiKey`; existing tests stay.

## Frontend changes required

- `usage` status segment: the three windows via `formatUsage`.
- `/usage` notification (error level on failure).
- No overlay/widget.
- **Manual TUI check** (documented in the walkthrough): segment appears for
  `opencode-go`; cleared for other providers; `/usage` refreshes; the retained
  `cloudflare-ai-usage` segment still renders; nothing throws in `pi --print`.

## Acceptance Criteria

Complete satisfaction of `Original Ask`, i.e.:

1. `pi -ne -e ./extensions/usage/index.ts` loads without error; `/usage` exists.
2. With `opencode-go` active, the `usage` status shows rolling/weekly/monthly
   percents (and reset times); for any other provider the segment is cleared.
3. **The key comes from Pi, and a real absence fails visibly:** `env -u OPENCODE_API_KEY`
   still works because the key is resolved from Pi's provider auth. Only when **both**
   Pi auth and the env var are absent does the status show
   `usage: opencode-go has no configured auth` and `/usage` report it with error
   level (unit-tested with an injected absent key).
4. **Provider failure fails visibly:** non-200 / timeout renders a visible error;
   no stale or zero data is shown as if valid.
5. **Nothing dropped:** `extensions/cloudflare-ai-usage.ts` still exists and is
   still in `pi.extensions`; Cloudflare's display is unchanged;
   `./extensions/usage/index.ts` is added.
6. In `print`/non-UI mode, no `ctx.ui.*` call is made and nothing throws.
7. `npm run check` exits 0 (typecheck, 0 failures, manifest) with new/changed tests
   covering the config and the render/decision helpers.
8. No `bun:sqlite`/`node:sqlite` in `extensions/usage/**`; the API key is resolved
   from Pi's auth (env fallback), never stored or logged. No `as any` /
   `as unknown as`, no `child_process` / `pi.exec`.

## Validation

```sh
npm run check
bun test tests/usage

# load in Pi from this directory (the point of the increment)
pi -ne -e ./extensions/usage/index.ts
#   /usage → refreshed opencode-go windows
env -u OPENCODE_API_KEY pi -ne -e ./extensions/usage/index.ts
#   → still works: the key comes from Pi's provider auth, not the env

# print-mode smoke (must not throw)
pi -ne -e ./extensions/usage/index.ts -p --no-session 'say ok'
```

Manual TUI checklist in the walkthrough.

## Deferred follow-ups (outside this outcome)

- Cloudflare port into a shared provider shape; opencode-go local token accounting.
- Consolidation of `cloudflare-ai-usage.ts` (only after `usage/` is verified).
- Increments 2, 4, **4b (duck)**, 5, 6, 7 — each needs its own plan + approval.
- Open from `plan-2` §6: per-turn token/cost aggregate.
