# The decision server (runtime setup)

`sandbox-dev` holds no permission policy — every `tool_call` is relayed to the decision server and
the verdict decides. That makes the **harness's decision set** the real safety surface, so this page
records what is enabled, how to verify it, and what is still uncovered.

The code path lives in [`extensions/sandbox-dev/index.ts`](../extensions/sandbox-dev/index.ts)
(`judgeCall`) and [`extensions/shared/jev.ts`](../extensions/shared/jev.ts) (`runJevDecision`).

## Where the setup lives

| Thing | Path |
|---|---|
| Harness config | `~/.jev-harness/config.json` |
| Credentials (`DECISIONS_TOKEN=…`) | `~/.jev-harness/credentials` (mode 600) |
| Decision ledger | `~/.jev-harness/ledger.jsonl` and `~/.jev-harness/jev.db` |
| Adapter the extension spawns | `~/.claude/skills/jev-harness/adapters/pi/run.ts` |
| Decision implementations | `~/.claude/skills/jev-harness/decisions/*.ts` |

Neither `~/.jev-harness` nor the jev-harness skills directory is a git repository: a config change is
persisted on disk only, so take a backup before editing.

```bash
cp ~/.jev-harness/config.json ~/.jev-harness/backups/config.$(date +%Y%m%dT%H%M%S).json
```

## Enabled decisions

`~/.jev-harness/config.json`:

```json
{
  "defaultMode": "enforce",
  "timeoutMs": 4000,
  "decisions": {
    "shell-safety":   { "mode": "enforce" },
    "failure-triage": { "mode": "enforce" },
    "outbound-leak":  { "mode": "enforce" },
    "memory-hygiene": { "mode": "enforce" }
  },
  "endpoint": "https://decisions.prashamhtrivedi.app/v1/systemone",
  "apiKeyName": "DECISIONS_TOKEN"
}
```

A decision only runs when its `applies(event)` predicate matches, so the table is the practical
coverage map:

| Tool kind | Decision | Applies when | Can reject? |
|---|---|---|---|
| `shell` | `shell-safety` | any non-empty `command` | **yes** — ask or deny |
| `fetch` | `outbound-leak` | URL contains `?` or `#` | **yes** |
| `mcp` | `outbound-leak` | payload ≥ 120 characters | **yes** |
| `write`/`edit` | `memory-hygiene` | path matches `…/memory/<name>.md`, not `MEMORY.md` | quality only — never a secret check |
| `read` (20–400 KB) | `read-budget` (`safety: false`) | not enabled here | advisory only |
| `read`, `write`, `edit`, small `mcp`, `spawn_agents` | *nothing* | — | no |

`memory-hygiene` compares against existing memories **locally** (`serverChecked: false` in the
ledger), so it costs no tokens; every other decision above calls the endpoint.

## Verifying coverage without running anything

Judging is separate from execution: pipe a neutral event into the adapter and read the verdict. This
never runs the command.

```bash
ADAPTER="$HOME/.claude/skills/jev-harness/adapters/pi/run.ts"
printf '%s' '{"sessionId":"probe","cwd":"'"$PWD"'","tool":{"name":"bash","kind":"shell","command":"cat ~/.ssh/id_rsa"}}' \
  | bun "$ADAPTER" pre_tool
# → {"gate":{"action":"ask","reason":"jev-harness: may print or send a secret's value (destroy=0.07)."}}
```

`{}` means approved; `gate.action` of `ask` or `deny` means the extension will show you one prompt.
For non-shell kinds, change `"kind"` (and `"path"` / `"mcpArgs"`) to match the tool you want to test.

## Reading what happened

Every judged call appends a row to `~/.jev-harness/ledger.jsonl`:

```bash
grep '"event":"pre_tool"' ~/.jev-harness/ledger.jsonl | tail -5
```

Useful fields: `verdict` (`none` / `ask` / `deny`), `applied`, `ms` (the real per-call cost),
`inputTokens`, and `signals` (the model's scores plus any `rules` that fired).

## Measured behaviour (2026-10-25, this machine)

- Each judged call cost **~650–1100 ms** and **~400–500 input tokens**.
- `rm -rf /tmp/<scratch>` → `destroy=0.25`, just under the rule-assisted ask line (`0.3`) → approved.
  The same command aimed at this repository → `destroy=0.41` → **ask**.
- `cat ~/.ssh/id_rsa` → `leak=0.92` → **ask**, prompted. The identical call again, one turn later,
  → `leak=0.07` → approved, because the transcript then contained the error saying the file does not
  exist.
- `sudo ls /root`, `git push --force origin main`, `chmod -R 777 /` → `{}` — `shell-rules.ts` has no
  rule for them.

**Consequence:** verdicts are contextual, not a function of the command text. The same call can flip
between turns, an approval is not permission for the next one, and the agent's own narration is part
of the evidence the server weighs — so an agent that *describes* a command as safe is not evidence
that it is.

## Known gaps and how to close them

1. **Plain reads and writes are relayed but unjudged.** No decision's `applies` covers them. Closing
   it means a `path-guard` decision in jev-harness (`applies: e.kind === "pre_tool" && ["read",
   "write", "edit"].includes(e.tool?.kind) && !!e.tool.path`) plus `"path-guard": { "mode":
   "enforce" }`. With an unconditional predicate that adds one server call to every read and edit, so
   it needs a cheap prefilter.
2. **`shell-rules.ts` has no rule for `sudo`, `git push --force`, or `chmod`/`chown -R`**, so Jev
   scores them from scratch and currently approves them.
3. **`memory-hygiene` will not catch secrets written into memory** — it detects duplicates and
   conflicts, not sensitive content.

## Rolling back

```bash
cp ~/.jev-harness/backups/config.<timestamp>.json ~/.jev-harness/config.json
```

Each judged call re-spawns the adapter, so a config edit takes effect on the next tool call: no Pi
reload and no restart.
