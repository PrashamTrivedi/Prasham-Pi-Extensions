# Walkthrough — mods-cockpit-duck

## What changed

- **`extensions/duck/prompt.ts`** — the prompt now asks for at most 5 questions,
  most important first.
- **`extensions/duck/index.ts`** — `capDuckQuestions` keeps the first 5 recognisable
  questions and appends `…and N more questions (capped at 5)`; unstructured prose is
  left alone.
- **`extensions/workbench/cockpit.ts`** — the overlay docks `top-right` at 32% width
  / 55% height with a 1-row margin; USAGE renders one meter row per provider window
  (label, percent, reset time) plus tokens/spend/note or an error; refresh fetches
  ledger + usage concurrently behind an in-flight guard.

## 1. Automated verification

```sh
cd /root/Code/Projects/Prasham-Pi-Extensions
npm run check
```

Expect: typecheck clean, `152 pass, 0 fail`, `... validated (9 extensions).`,
`... enabled here.`, exit 0.

## 2. Cockpit (TUI)

```sh
pi -ne -e ./extensions/workbench/index.ts
```

- `/cockpit` → the panel appears in the **top-right corner** and leaves the
  mid-screen transcript readable.
- While it is open you can keep typing and run other commands (non-capturing).
- `CONTEXT` meter + token count; `USAGE` shows one row per window:
  `rolling ██░░░░░░░░░░ 12% · resets 3h`.
- A missing key or a failed request shows a red usage row; a missing ledger shows a
  red `ledger: …` row; neither ever blanks the panel.
- `/cockpit` again hides it; shrinking below 120 columns hides it automatically.

## 3. Duck (TUI)

```sh
pi -ne -e ./extensions/duck/index.ts
# /duck what am I missing?
```

- The answer is capped at five questions; if the model returns more, the panel
  ends with `…and N more questions (capped at 5)`.
- Arrows / `j` `k` / PgUp / PgDn / `g` `G` scroll; `esc`, `q`, `ctrl+c`, or running
  `/duck` again closes it (unchanged from the previous increment).

## 4. Print-mode smoke (must not throw)

```sh
pi -ne -e ./extensions/workbench/index.ts -p --no-session 'say ok'
pi -ne -e ./extensions/duck/index.ts      -p --no-session 'say ok'
```

Expect `exit 0` and `ok` from both.

## 5. What a human should verify

- The cockpit no longer covers the transcript text you are reading, and the editor
  keeps focus.
- The USAGE section shows real windows (not `(unavailable)`) when opencode-go is
  the active provider, and a visible error otherwise.
- Duck never shows more than five questions.

## 6. Commits

```
a442782 ✨ feat: Cap duck at five questions
b6b67ee ✨ feat: Show usage windows in a corner cockpit
<docs> 📝 docs: Record cockpit and duck refinement validation
```

`git log --oneline a3f6e47..HEAD` should show the above.
