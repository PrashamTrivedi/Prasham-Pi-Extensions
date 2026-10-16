# Spec A — Package-check hardening + baseline hygiene

Parent: `taskNotes/pi-mods-foundation/taskFindings.md`
Source: `docs/pi-mods-plan.md` §4 (item 0.1) and `docs/pi-mods-review.md` §4 defect 4.

## Purpose

Remove the hardcoded extension count from the package checker so the pack can grow,
and put the working tree into a clean, committable baseline.

## Original Ask

Drop `assert.equal(pkg.pi.extensions.length, N)` from `scripts/check-package.mjs`;
keep "entry exists" and "helper not listed"; add "every listed entry has a default
export"; make the script pass for 4–12 entries without edits.

## Complexity and the reason behind it

**2 / 5.** One small script edit plus a dirty-tree decision. The only subtlety is
that a `.ts` entry cannot be `import`ed by the Node-run script, so the default-export
check is a source scan.

## Architectural changes required

None. The change is confined to `scripts/check-package.mjs` and the commit baseline.

## Backend changes required

`scripts/check-package.mjs`:

- Delete line 8 (`assert.equal(pkg.pi.extensions.length, 6);`).
- Keep the repository-URL assertion, the per-entry existence check, and the
  helper-name guard.
- Add: for each entry, read the file and assert `/export\s+default/` matches,
  failing with `Entry has no default export: <entry>`.
- Keep the public-asset existence checks.

Baseline hygiene (prerequisite for the completion commit):

- The working tree carries pre-existing uncommitted sandbox-dev work
  (`extensions/sandbox-dev/`, `tests/sandbox-dev/`, `prompts/`, `skills/`,
  `examples/sandbox-dev.json`, `README.md`, `CHANGELOG.md`, `package.json`,
  `package-lock.json`, `scripts/check-package.mjs`). Decide with the human:
  commit it as its own baseline commit first (recommended: `chore: add sandbox-dev
  extension and bump Pi to 1.2.0`) **before** the pi-mods commits, so pi-mods
  commits contain only pi-mods files. Do not fold unrelated sandbox-dev work into
  a pi-mods commit.

## Frontend changes required

None.

## Acceptance Criteria

1. `node scripts/check-package.mjs` exits 0 on the current manifest.
2. No `extensions.length` assertion remains.
3. Appending a valid 7th entry (then removing it) does not require editing the
   script; a missing file fails with `Missing entry point`; an entry without
   `export default` fails with `no default export`.
4. The pi-mods commit(s) contain only pi-mods files; sandbox-dev baseline is a
   separate, earlier commit.

## Validation

```sh
node scripts/check-package.mjs          # exit 0
grep -c "extensions.length" scripts/check-package.mjs   # expect 0
```

Manual negative checks: add a fake `./extensions/nope.ts` entry → expect a
`Missing entry point` failure; add a real file without `export default` → expect a
`no default export` failure; revert both.
