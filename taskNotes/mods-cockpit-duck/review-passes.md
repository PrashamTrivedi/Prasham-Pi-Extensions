# Review passes — mods-cockpit-duck

Bounded review-fix loop over the diff `a3f6e47..HEAD`.

## Pass 1 — deep read of the full diff: 1 finding

1. **`getApiKeyForProvider` rejection could escape (fixed).** `refresh` used
   `Promise.all([recentCalls(5), fetchUsage(ctx)])`. `recentCalls` never throws and
   `fetchOpencodeGoUsage` never throws, but `modelRegistry.getApiKeyForProvider`
   could reject; that would reject `Promise.all` and surface as an unhandled
   rejection from the `void refresh()` call sites. Fixed by wrapping `fetchUsage`
   in try/catch and returning a `ProviderUsage` with an `error`, so the failure
   renders as a visible usage row and the snapshot is never left blank.
   The no-key case now also reports `OPENCODE_API_KEY not set` (fail visibly)
   instead of falling through to `(unavailable)`.

## Pass 2 — confirm fix and spawned issues: 0 findings

- The try/catch covers both the key lookup and the fetch; the returned value is a
  valid `ProviderUsage` (`windows: []`), so `buildCockpitSections` takes the
  `error` branch.
- `capDuckQuestions` boundary re-checked: exactly 5 → unchanged; 6+ → keeps 5,
  reports the remainder; unstructured prose → unchanged.
- `npx tsc --noEmit` exit 0; 35 targeted tests pass, 0 fail.

Terminated by: **zero findings** (2 passes, below the 5-pass cap).

## Security review of the diff: clean

- **Auth / authorization:** no change.
- **Credentials / secrets:** the API key is still passed straight into
  `fetchOpencodeGoUsage`; it is never logged. The new catch only surfaces the
  error message, not the key.
- **Injection (`eval`, `exec`, raw SQL, shell interpolation):** none.
- **Unsafe deserialization / HTML escapes:** none; `formatReset` only `Date.parse`s
  a provider string.
- **Network:** no new requests; the same opencode-go usage endpoint, now fetched
  concurrently and guarded by an in-flight flag.

Result: no security findings.
