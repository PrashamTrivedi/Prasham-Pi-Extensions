# Local-first development rule

Every extension developed in this repository must be **enabled here first**, then
promoted to the broader system.

## The rule

1. **Register the extension** in `package.json` → `pi.extensions`.
2. **`.pi/settings.json` loads this package locally** (`"packages": [".."]`), so a
   registered entry is automatically enabled in this directory. Do not remove that
   declaration.
3. **`npm run check` enforces both**: `scripts/check-local.mjs` fails if
   - an `exports default` extension entry under `extensions/` is missing from
     `pi.extensions`, or
   - `.pi/settings.json` no longer declares this package.
4. **Promote only after it works here.** Reload Pi (`/reload`), use the extension
   in this directory, then allow it in the broader system (global settings, a git
   tag, or `pi install`).

## Why

Developing against the local package means the code you edit is the code Pi runs —
no install/update cycle, no version skew. Promotion is a deliberate second step,
so a half-finished extension never leaks into the global configuration.

## Notes

- `.pi/` is tracked so the rule travels with the repository.
- This package is also declared in the agent settings; Pi dedupes local packages by
  resolved absolute path, so it does not load twice.
- Do not edit `herdr-agent-state.ts` (herdr-managed).
