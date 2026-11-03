# Backend validation — sandbox-prompts

Work mode: backend (policy + extension code, no UI layer).

## Commands run

```bash
$ npm run typecheck
> tsc --noEmit
TYPECHECK_EXIT=0

$ npm test
 222 pass
 0 fail
 926 expect() calls
Ran 222 tests across 33 files. [2.16s]
TEST_EXIT=0

$ npm run check
 222 pass
 0 fail
 926 expect() calls
Ran 222 tests across 33 files. [1.76s]
Package manifest and public assets validated (12 extensions).
Local-first enablement validated (12 extensions enabled here).
EXIT=0
```

## Criteria → proof

| Criterion (`taskFindings.md`) | Proving test |
|---|---|
| A `read` outside cwd never reaches `ctx.ui.confirm` | `policy.test.ts` › `reads outside the working directory are allowed`; `extension.test.ts` › `a read outside the working directory never reaches the human` (asserts `confirmCalls` is empty) |
| Writes inside cwd, `~/.pi/agent`, `/tmp` allowed; elsewhere confirmed | `policy.test.ts` › `writes under an allowed root are allowed, and deny still wins there`, `writes outside the working directory require confirmation` |
| `.env` / `.ssh` still deny, even inside an allow root | same test (`/tmp/.env` write and read → `deny`) |
| Installs and network calls no longer confirm | `policy.test.ts` › `installs and network calls no longer confirm; destructive commands still do` (`curl`, `wget`, `npm install`, `bun add`, `docker`, `brew`, `apt-get` → `allow`) |
| Destructive/publish commands still confirm | same test (`sudo`, `rm -rf`, `rm -r`, `git reset --hard`, `chmod`, `chown`, `npm publish`, `git push`) |
| Mentioned-only patterns do not confirm | `policy.test.ts` › `a pattern that merely appears in the command does not confirm`; `matchCommand` tests (`curly`, `git pushy`, `rm -r` inside `rm -rf`) |
| `git push --force` still denies; shell → Jev handshake unchanged | `policy.test.ts` › `force push stays a deny`; `autoprocess.test.ts` › all six shell-confirm routing tests (updated to still-confirming commands) |
| `/dev-status` reports counters | `extension.test.ts` › `/dev-status reports confirm-tier calls and Jev auto-approvals, and /dev-reset clears them` (`policy: 2 confirm(s), 1 auto-approved (Jev)`, then `0 confirm(s), 0 …` after `/dev-reset`) |
| `PI_SANDBOX_ALLOW_ROOTS` extends, relative entries dropped | `policy.test.ts` › `writeAllowRoots` tests |

## Interactive check still required

The suite proves the policy function and the extension hooks. One prompt-free session must be
observed in a real TUI (`/reload`, then read a skill file, read a memory file, run an install-free
command) — see `taskWalkthrough.md`. That is the only claim the tests cannot make.
