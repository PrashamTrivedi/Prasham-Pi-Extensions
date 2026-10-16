# Walkthrough — pi-mods-foundation

Everything here runs from the repo root. No extension is registered by this
increment, so no Pi session is needed to verify it.

## 1. Setup

```sh
cd /root/Code/Projects/Prasham-Pi-Extensions
bun install            # if node_modules is absent; otherwise skip
```

## 2. Verify the whole increment

```sh
npm run check
```

Expect: `tsc --noEmit` clean, then `79 pass, 0 fail`, then
`Package manifest and public assets validated (6 extensions).` and exit 0.

## 3. Verify the ledger server (Bun) against the real ledger

```sh
PI_JEV_LEDGER_PORT=37651 bun run extensions/shared/ledger-server.ts &
curl -s "http://127.0.0.1:37651/decision-counts"
curl -s "http://127.0.0.1:37651/recent-calls?limit=3"
kill %1
```

Expect JSON `{"rows":[...]}`. With no server running, the client returns
`{ rows: [], error: ... }` instead of throwing:

```sh
bun -e 'import("./extensions/shared/ledger.ts").then(async m => console.log(await m.recentCalls(1, { baseUrl: "http://127.0.0.1:37999" })))'
```

Expect `{ rows: [], error: "..." }` (connection refused).

## 4. Verify the opencode-go reporter without network

```sh
bun test tests/usage/opencode-go.test.ts
```

Then confirm it degrades with no key:

```sh
env -u OPENCODE_API_KEY bun -e 'import("./extensions/usage/opencode-go.ts").then(async m => console.log(await m.fetchOpencodeGoUsage({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) })))'
```

Expect `{ provider: "opencode-go", windows: [], error: "OPENCODE_API_KEY not set" }`.

## 5. Verify the checker is count-independent

```sh
node scripts/check-package.mjs          # exit 0
```

To prove it no longer pins a count, add any extra `pi.extensions` entry: a
missing path fails with `Missing entry point`, and a file without `export default`
fails with `Entry has no default export`. Remove the entry afterward.

## 6. What to verify for a human reviewer

- `git log --oneline 3fd0166..HEAD` shows four conventional commits (docs,
  checker, shared library, reporter).
- `git diff 3fd0166..HEAD --stat` touches only `taskNotes/`, `scripts/`, and
  `extensions/{shared,usage}` plus `tests/{shared,usage,fixtures}`.
- `grep -rn "child_process\|execFile\|pi.exec\|as unknown as\|as any" extensions/shared extensions/usage`
  returns nothing.
