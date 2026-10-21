# fabric-ui-rework — review passes

| Pass | Findings | Fixed |
| --- | --- | --- |
| 1 | 3 | `idOrIds` needless helper inlined; `TranscriptPane.setSpec` dead code (and an `as` cast) removed; collapsed rows now render `· N hidden` so folding a group hides nothing silently |
| 2 | 0 | — (terminated by zero) |

Security review of the diff, per class:

- **Auth / authorization:** none touched; no permission logic changed.
- **Credentials / secrets:** none read, logged, or persisted; the diff only reads local session JSONL and writes state files Fabric already owned.
- **Injection:** no new `eval`, `exec`, or shell interpolation. The only new process interaction is the existing `cancelTree` kill path, unchanged. Session text is rendered as text and control sequences are stripped by `clean()`.
- **Deserialization:** `JSON.parse` on session lines, guarded per line; malformed lines are skipped.
- **Escaping / HTML:** not applicable — terminal rendering only, width-bounded.
