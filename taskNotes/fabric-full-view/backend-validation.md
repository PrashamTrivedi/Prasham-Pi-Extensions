# fabric-full-view — backend & parser validation

Run 2026-10-21.

## Real CLI: a child session lands where the parent looks

```
$ pi -p --session-dir /tmp/fabric-verify --session-id fabricverify-1 --approve \
     --no-extensions --model opencode-go/deepseek-v4.1-flash -- "Reply with exactly: OK"
OK
$ ls /tmp/fabric-verify/
2026-10-21T07-14-20-453Z_fabricverify-1.jsonl
```

`--session-dir` is used flat (no per-cwd subfolder) and the file is
`<timestamp>_<session-id>.jsonl`, matching `resolveSessionFile`'s suffix lookup.

## Real session replays through the viewer's parser

```
resolved: 2026-10-21T07-14-20-453Z_fabricverify-1.jsonl
kinds: note,user,assistant | count: 4
  note | model → opencode-go/deepseek-v4.1-flash
  note | thinking → high
  user | Reply with exactly: OK
  assistant | OK
```

## Suites

- `npx tsc --noEmit` — clean.
- `npm run check` — `189 pass, 0 fail`, 1 122 assertions, 31 files; package manifest and
  local-first enablement validated (11 extensions).
- Fabric-specific: `tests/fabric` — `22 pass, 0 fail`.
