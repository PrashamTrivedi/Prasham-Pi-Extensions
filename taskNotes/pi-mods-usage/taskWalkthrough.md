# Walkthrough — pi-mods-usage

## What this gives you

A live `/usage` command and a `usage` status segment showing **opencode-go**
limits (rolling / weekly / monthly). The key comes from Pi's own auth, so nothing
needs configuring. Cloudflare keeps its existing `cloudflare-ai-usage` extension,
untouched.

## 1. Run the automated gate

```sh
cd /root/Code/Projects/Prasham-Pi-Extensions
npm run check
```

Expect: typecheck clean, `86 pass, 0 fail`, `Package manifest and public assets
validated (7 extensions).`, exit 0.

## 2. Load it in Pi from this directory

```sh
pi -ne -e ./extensions/usage/index.ts
```

Then, in the session:

- Look at the status area: with an `opencode-go` model active you should see a
  `usage` line like
  `opencode-go: rolling 2% · weekly 0% · monthly 0% (percent-only; provider reports no spend or tokens)`.
- Switch to a different provider (e.g. `cloudflare-workers-ai`): the `usage`
  segment clears (Cloudflare's own segment, if present, is separate).
- Run `/usage`: it forces a refresh; on failure you get a red notification with the
  reason.

`-ne` disables extension discovery, so **only** this extension loads — nothing to
configure, no duplicate registration.

## 3. Print-mode smoke (no TUI)

```sh
pi -ne -e ./extensions/usage/index.ts -p --no-session 'say ok'
```

Expect `ok` and exit 0. A load failure would print
`Failed to load extension "./extensions/usage/index.ts": …`.

## 4. Prove the key comes from Pi (not the env)

```sh
env -u OPENCODE_API_KEY pi -ne -e ./extensions/usage/index.ts
```

The status still renders — the key is resolved via
`ctx.modelRegistry.getApiKeyForProvider("opencode-go")`. Only if **both** Pi auth
and the env var are missing do you see
`usage: opencode-go has no configured auth (set OPENCODE_API_KEY or sign in to Pi)`.

## 5. Optional: load the whole package locally

```sh
pi install -l .        # writes .pi/settings.json (not gitignored)
```

Loads every entry in `pi.extensions`, including the retained
`cloudflare-ai-usage` extension. Remove with `pi remove -l .`.

## 6. What to verify as a human reviewer

- The `usage` segment appears and updates; the retained `cloudflare-ai-usage`
  segment is unaffected.
- `/usage` notification (and its error colour/level on failure).
- Theme change and regular vs fullscreen do not break the segment.
- `git log --oneline c6bc0da..HEAD` shows the usage commit(s) only.
