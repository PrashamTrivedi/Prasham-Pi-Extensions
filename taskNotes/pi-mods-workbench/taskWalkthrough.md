# Walkthrough — pi-mods-workbench

## 1. Automated gate

```sh
cd /root/Code/Projects/Prasham-Pi-Extensions
npm run check
```

Expect: typecheck clean, `115 pass, 0 fail`, `... validated (9 extensions).`, exit 0.

## 2. Workbench (pet, statusline, cockpit, observability)

```sh
pi -ne -e ./extensions/workbench/index.ts
```

- Watch the working indicator animate and a themed verb appear per turn.
- Footer shows `branch · ctx% · duration · tokens tok`, then the `usage` segment.
- `/pet` → state; `/pet theme barca` → pin a theme.
- `/context` → context % and the injector ceilings (8,000 / `PI_RECURSIVE_CONTEXT_MAX`).
- `/report` → tool-call/token summary from `~/.pi/agent/state/session.jsonl`.
- `/cockpit` → right overlay (needs ≥120 columns).

Cockpit with Jev decisions needs the ledger server running:

```sh
PI_JEV_LEDGER_PORT=37650 bun run extensions/shared/ledger-server.ts   # terminal A
# then /cockpit in Pi; without it the cockpit shows "ledger: ..." visibly
```

Configuration: copy `examples/workbench.config.json` to `~/.pi/agent/workbench.config.json`
(or `./.pi/workbench.config.json`) and toggle features.

## 3. Duck

```sh
pi -ne -e ./extensions/duck/index.ts
# /duck what am I missing?
```

Expect a questions-only list and a widget header with nested `in/out` token usage.

## 4. Print-mode smoke (must not throw)

```sh
pi -ne -e ./extensions/workbench/index.ts -p --no-session 'say ok'
pi -ne -e ./extensions/duck/index.ts      -p --no-session 'say ok'
```

## 5. What a human should verify

- Footer repaint on branch change; overlay placement and hiding below 120 columns.
- `nonCapturing` keeps the keyboard in the editor; if it does not, fall back to
  `setWidget` (documented risk).
- Theme switch and regular vs fullscreen.
- `/duck` returns questions only.
- `git log --oneline c57e8ce..HEAD` shows the four increment commits.
