# Review passes — pi-mods-foundation

Diff reviewed: `3fd0166..HEAD` (foundation commits) plus the pass-1 fixes.

## Pass 1 (deep, line by line): 4 findings

1. **`formatUsage` could render an empty segment.** With no windows, no tokens,
   no USD, and no note it returned `"<provider>: "`. Fixed: returns
   `"<provider>: no data"`. Test added.
2. **opencode-go TTL cache was not scoped to the endpoint.** The module-level
   cache held one value regardless of `baseUrl`/`keyEnv`, so a call to a different
   endpoint could return the previous endpoint's value. Fixed: cache keyed by
   `` `${baseUrl}|${keyEnv}` ``. Test added.
3. **Checker default-export scan was too loose.** `/export\s+default/` could match
   inside a comment. Fixed: anchored to line start `/^export\s+default\b/m`.
4. **Test env not restored.** `tests/usage/opencode-go.test.ts` set
   `OPENCODE_API_KEY` without cleanup, leaking into other tests. Fixed: added
   `afterEach` cleanup.

## Pass 2 (confirm fixes + spawned issues): 0 findings

Re-ran the full suite after the fixes. The two new tests exercise findings 1 and 2;
the anchored regex and env cleanup are exercised by the existing paths.

## Verdict

Terminated by **zero findings** (before the 5-pass cap).
