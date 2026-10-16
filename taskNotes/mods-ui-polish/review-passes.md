# Review passes — mods-ui-polish

Bounded review-fix loop over the diff `e064dc6..HEAD`.

## Pass 1 — deep read of the full diff: 2 findings

1. **Duck frame height budget off by one (fixed).** `duckBodyRows` subtracted 3
   chrome rows from the 80% budget, but the frame adds four (top rule, separator,
   footer, bottom rule). On a 10-row terminal the panel was 9 rows against a
   `maxHeight` of 8, clipping the bottom border. Changed the subtraction to 4 and
   updated the `duckBodyRows` test (`40 → 24`, `10 → 4`).
2. **Panel widths below 4 cannot carry a frame (documented, not reachable).**
   `borderTop` needs at least 2 inner columns; below that the corners overflow the
   requested width. Every overlay uses `minWidth >= 40`, so this is outside the
   reachable range. Documented on `renderPanel` rather than adding dead guards.

## Pass 2 — confirm fixes and spawned issues: 0 findings

- Re-read `extensions/shared/panel.ts` and the duck `handleInput`/render path.
- The `-4` fix does not affect the 40-row case (still clamped to 24) or the
  short-body padding path.
- No new issues. `npx tsc --noEmit` exit 0; 31 targeted tests pass, 0 fail.

Terminated by: **zero findings** (2 passes, below the 5-pass cap).

## Security review of the diff: clean

- **Auth / authorization:** no change; no permission logic touched.
- **Credentials / secrets:** none added; the existing `getApiKeyForProvider` /
  `OPENCODE_API_KEY` path is unchanged and never logs the key.
- **Injection (`eval`, `exec`, raw SQL, shell interpolation):** none; the diff is
  pure string/ANSI composition.
- **Unsafe deserialization / HTML escapes:** none; no `JSON.parse` of untrusted
  input and no DOM/HTML surface.
- **Network:** no new requests; `recentCalls` and `fetchOpencodeGoUsage` are
  pre-existing.

Result: no security findings.
