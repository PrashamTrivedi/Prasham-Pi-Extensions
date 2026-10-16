# Spec C — `usage/opencode-go.ts` reporter

Parent: `taskNotes/pi-mods-foundation/taskFindings.md`
Source: `docs/pi-mods-plan.md` §6.1.

## Purpose

Prove the shared `ProviderUsage` contract against a real provider by mapping
opencode-go's quota endpoint to three usage windows, with the verified live payload
committed as a fixture.

## Original Ask

Add `extensions/usage/opencode-go.ts` that fetches
`GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer
$OPENCODE_API_KEY`, maps `rolling`/`weekly`/`monthly` to three `UsageWindow`s,
TTL-caches 60 s, and tolerates non-200, non-JSON, and timeout without throwing.
Never log or persist the key. Add the verified live payload as a fixture and test
the mapping.

## Complexity and the reason behind it

**3 / 5.** The mapping is small and pure, but the endpoint is undocumented and
unversioned, and provider semantics (percent-only, no spend, no tokens) must be
encoded honestly. Tests must not touch the network.

## Architectural changes required

None beyond importing `shared/usage.ts`. This module is **not** registered as an
extension entry in this increment; it is a tested library function.

## Backend changes required

`extensions/usage/opencode-go.ts`:

```ts
export type FetchLike = (input: string, init?: { headers?: Record<string,string>; signal?: AbortSignal }) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>;
}>;

export async function fetchOpencodeGoUsage(options?: {
  keyEnv?: string;          // default "OPENCODE_API_KEY"
  baseUrl?: string;         // default "https://opencode.ai/zen/go/v1/usage"
  fetchImpl?: FetchLike;    // default global fetch (injected in tests)
  now?: () => number;       // for TTL tests
}): Promise<ProviderUsage>; // provider: "opencode-go"
```

- Read the key only from `process.env[keyEnv]`. If absent → return
  `{ provider:"opencode-go", windows:[], error:"OPENCODE_API_KEY not set" }`.
- Send the key to exactly one host (`baseUrl`). Never log it, never write it to
  config or a state file.
- Map `rolling`→"rolling", `weekly`→"weekly", `monthly`→"monthly", preserving
  `percent` and `resetsAt`. Percent-only: no tokens, no USD; set `note` saying so.
- TTL cache (60 s) keyed by the resolved key env value's presence, holding only the
  mapped `ProviderUsage` (never the key).
- Failures (`!ok`, JSON parse error, timeout via `AbortSignal.timeout`) → return a
  `ProviderUsage` with `error` set and no windows; never throw.

## Frontend changes required

None.

## Acceptance Criteria

1. `tests/fixtures/opencode-go-usage.json` contains the exact verified payload
   (three windows with `status`, `percent`, `resetsAt`).
2. The mapping produces exactly three `UsageWindow`s in order rolling, weekly,
   monthly, with the fixture's percents and reset timestamps.
3. A non-200 response, a non-JSON body, and a timeout each yield a `ProviderUsage`
   with `error` set, `windows: []`, and no thrown exception.
4. No test performs real network I/O; `fetchImpl` is injected.
5. A test asserts the key is read from the env and that no output contains the key
   string.
6. No `as any` / `as unknown as`; no `child_process` / `execFile`.

## Validation

```sh
bun test tests/usage        # 0 fail
npm run typecheck
```

Tests (`tests/usage/opencode-go.test.ts`):

- fixture → three windows, exact percents/resets;
- `fetchImpl` returning `{ok:false,status:404}` → `error`, no throw;
- `json()` rejecting → `error`, no throw;
- missing `OPENCODE_API_KEY` → `error` mentioning the env var;
- TTL: two calls within 60 s invoke `fetchImpl` once (using injected `now`).

## Risks

`/zen/go/v1/usage` is undocumented and unversioned; it may change shape or vanish.
The fixture exists precisely so a shape change fails loudly. Any parse failure
degrades to an `error` string and leaves the caller's token accounting unaffected.
