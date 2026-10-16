# Frontend (TUI) validation — pi-mods-workbench

Interactive rendering cannot be asserted in print mode. These are the manual checks
for a real Pi TUI session, with the expected observation. Run:

```sh
cd /root/Code/Projects/Prasham-Pi-Extensions
pi -ne -e ./extensions/workbench/index.ts
```

| # | Check | Expected |
|---|---|---|
| 1 | Working indicator during a turn | animated `◐◓◑◒` frames |
| 2 | Working message each turn | a themed verb from `verbs.ts`, changing per turn |
| 3 | `/pet` | notify with theme, mood, turn |
| 4 | `/pet theme barca` then a turn | verbs restricted to the barca list |
| 5 | Footer line 1 | `<branch> · ctx <n>% · <duration> · <tokens> tok` |
| 6 | Footer line 2 | the `usage` segment (from the usage extension) when present |
| 7 | Branch switch (`git checkout -b`) | footer branch updates without restart |
| 8 | `/context` | context % and the two injector ceilings |
| 9 | `/report` | tool calls + token total, or "no session records yet" |
| 10 | `/cockpit` | right-anchored overlay; context/tokens/usage/Jev decisions |
| 11 | Narrow terminal (<120 cols) | cockpit overlay hidden |
| 12 | Escape / `/cockpit` again | overlay closes; typing still works (nonCapturing) |
| 13 | `session_shutdown` (quit) | footer restored to built-in; indicator default |

Duck:

```sh
pi -ne -e ./extensions/duck/index.ts
# /duck <prompt>
```

| # | Check | Expected |
|---|---|---|
| 14 | `/duck` output | questions only, no answers/edits |
| 15 | duck widget header | `duck · <provider>/<model> · in N / out M` |
| 16 | no active model | visible error notification |
| 17 | quit | duck widget cleared |

Also check theme switching and regular vs fullscreen do not break the footer or
overlay.
