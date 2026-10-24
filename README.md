# Prasham Pi Extensions

**Parallel agents you can follow. Project context you do not have to repeat.**

A Git-installable collection of [Pi](https://github.com/earendil-works/pi-mono) extensions by [Prasham Trivedi](https://github.com/PrashamTrivedi). Fabric is the flagship: recursive agent teams with isolated Git worktrees and three live terminal views.

![Illustrative preview of Fabric's status line, comparison cards, and framed inspector](docs/preview.svg)

> The preview uses simulated, non-sensitive data. It is an illustration of the UI, not a recording of an agent run. Open [the interactive preview](https://PrashamTrivedi.github.io/Prasham-Pi-Extensions/preview.html), or run it locally with `npm run preview`.

## Install from Git

```sh
pi install git:github.com/PrashamTrivedi/Prasham-Pi-Extensions@v0.1.0
```

Run `/reload` inside an existing Pi session. Requires a recent Pi with the `@earendil-works` extension APIs; development targets **Pi 1.2.0** and Node **22.19+**. Fabric additionally requires Git, a repository with at least one commit, a `pi` executable on PATH, and authenticated model access. Shell-oriented context helpers are intended for macOS/Linux.

Install for a project instead:

```sh
pi install -l git:github.com/PrashamTrivedi/Prasham-Pi-Extensions@v0.1.0
```

Use `pi config` to disable individual extensions. To install only Fabric, use this package entry in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/PrashamTrivedi/Prasham-Pi-Extensions@v0.1.0",
      "extensions": ["extensions/fabric/index.ts"]
    }
  ]
}
```

Merge that entry into your existing settings; do not replace unrelated configuration.

## What's inside

| Extension | What it does | Controls |
| --- | --- | --- |
| **Fabric** | Recursive agent teams, worktree isolation, live agent rows, comparisons, and per-agent transcripts | `/agents`, four agent tools |
| **Usage** | Shows opencode-go rolling / weekly / monthly quota windows in one status segment | `/usage`, `usage.config.json` |
| **Workbench** | Pet indicator, two-line footer, and a cockpit docked above the editor with context, provider usage, and recent decisions | `/cockpit`, `workbench.config.json` |
| **Duck** | Docked questions-only second opinion; `/duck answer` collects answers with a Claude-style questionnaire | `/duck`, `/duck answer` |
| **Project context** | Adds the working directory, a bounded directory tree, and Git state (branch, remote, uncommitted files) to the system prompt | `PI_TREE_DEPTH`, `PI_TREE_MAX`, `PI_GIT_STATUS_MAX` |
| **Recursive context** | Loads nested `AGENTS.md` / `CLAUDE.md` in trusted projects | `PI_RECURSIVE_CONTEXT_MAX`, `PI_RECURSIVE_CONTEXT_NAMES` |
| **Memory** | Gives each project a local Markdown memory (`next_`, `project_`, `feedback_`, `reference_` notes plus an index) and injects the location and protocol so the model reads and writes it with normal file tools | `PI_MEMORY_ROOT` |
| **Cloudflare AI usage** | Estimates locally observed Workers AI token usage and optionally fetches billing data; renders only while a Workers AI model is active | `/cf-ai-usage`, external config |
| **Skill-name sanitizer** | Previews and optionally corrects invalid skill frontmatter names | `/sanitize-skills`, `/sanitize-skills apply` |
| **sandbox-dev** | Native plan → approve → implement → verify loop: minimal tool-permission floor, a conversational plan gate, single-outcome supervision | `/dev-approve`, `/dev-status`, `/dev-reset`, two tools |

The herdr-generated integration is intentionally not redistributed. Install herdr's own integration separately.

## Documentation

One guide per extension: [fabric](docs/fabric.md) · [usage](docs/usage.md) · [workbench](docs/workbench.md) · [duck](docs/duck.md) · [project context](docs/project-context.md) · [recursive context](docs/recursive-context.md) · [memory](docs/memory.md) · [Cloudflare AI usage](docs/cloudflare-ai-usage.md) · [skill-name sanitizer](docs/sanitize-skill-names.md) · [sandbox-dev](docs/sandbox-dev.md). The shared library is documented in [docs/shared.md](docs/shared.md).

## Fabric: delegate without losing the thread

Ask Pi naturally:

> Explore two approaches to this issue in parallel. Use Fabric where useful, compare the evidence, and do not apply patches without reviewing them.

The model decides whether delegation is useful. Fabric supplies the execution tools, not a mandatory workflow.

### 1. Agent rows below the prompt

As soon as a delegated agent spawns, it appears in a stack of rows under the prompt — one line per
agent, never covering the transcript, never taking keyboard focus:

```
◆ main · deepseek-v4.1-flash · thinking · 12m
├─ ● api-refactor · qwen · running npm test · 2m
└─ ○ tests · qwen · queued · —
```

Each row shows a status icon, the agent's own color, its name, model, what it is doing right now,
and how long it has been running. The main chat is the first row; agents spawned by an agent are
indented under it. The stack caps at six rows (then `+N more`) and disappears entirely when the main
chat is alone. Colors are generated per agent, so the same agent is the same color every time.

An agent that stays idle for more than ten minutes leaves the rows and `/agents`. That is display
only: its transcript, result, and patch stay on disk, and `agent_status` still reports it.

### 2. Comparison cards in the conversation

While `await_agents` runs, cards update with reported findings. Wide terminals show two cards side
by side; narrow terminals stack them. Expand the tool output for additional agents and detail.
Finished workers also produce persistent result cards without adding UI telemetry to the parent
model's context.

### 3. `/agents` — the way in

`/agents` lists the main chat and every live agent as a tree. Arrows select, `→` expands, `←`
collapses, `Enter` opens, `x` cancels an agent and its descendants (after a `y/n` confirmation), and
`Esc` returns to the chat.

Opening an agent replaces the chat with **its full conversation** — every message, tool call, and
tool result — with the agent's color on the header, a rule, and its message bands so it is obvious
you are not in the main chat. `Esc` returns to `/agents`, `Esc` again to the chat. The main chat
opens the same way, read from the live session.

Agents spawned by one `spawn_agents` call form a comparison group: one group row, opened as two
columns with its own header per agent. `s` toggles between two columns and one at a time, `tab`
switches which column the page keys scroll.

| Key | In `/agents` | In a transcript |
| --- | --- | --- |
| `↑` / `↓`, `j` / `k` | Select | Scroll the focused agent |
| `→` / `←` | Expand / collapse | — |
| `Enter` | Open the selected agent or group | — |
| `x` | Cancel the selected agent (+ descendants) | — |
| `s` | — | One column / two columns |
| `tab` | — | Focus the other agent |
| `PageUp` / `PageDown`, `Home` / `End` | — | Scroll / jump |
| `Esc` | Close the list | Back to `/agents` |

### Agent tools

- `spawn_agents`: queue independently useful tasks on selected models.
- `await_agents`: wait for direct children, releasing a waiting worker's active slot.
- `agent_status`: inspect the tree and optional results.
- `cancel_agents`: cancel a subtree.

Each worker is a separate Pi process. Delegation follows the configured hierarchy: a model named in the hierarchy may spawn an equal or lower rank, and a model that is not named is unrestricted — it may be spawned from any caller and may delegate to any model. No task timeout or turn cap is imposed; concurrency is bounded by the configured active-agent count. Model calls can incur costs. Review patches and rerun tests before integrating anything.

### Configuration

Keep personal configuration **outside the installed Git checkout**. See [examples/fabric.config.json](examples/fabric.config.json) and [the Fabric configuration guide](docs/fabric.md). Model IDs in examples are placeholders, not bundled model access or subscriptions.

```sh
mkdir -p ~/.pi/agent
# After cloning this repository; edit the model IDs before use:
cp examples/fabric.config.json ~/.pi/agent/pi-fabric.config.json
```

`PI_FABRIC_CONFIG` can point at a different configuration file. A `/reload` re-applies config changes to the existing Fabric root, so a hierarchy edit takes effect on the next spawn without starting a new session. The live UI reconnects to a run after `/reload` when its reference is saved in the Pi session.

Results, patches, activity snapshots, and worktrees live under the system temporary directory, in `pi-fabric/<root-id>/`. They are local—not uploaded by the preview or package. Temporary storage is not a backup. Remove worktrees through Git after reviewing or discarding their changes; deleting directories alone leaves worktree metadata behind.

### Important boundaries

- A Git worktree prevents accidental checkout collisions; **it is not an OS sandbox**.
- Workers can access the host filesystem, network, and inherited credentials.
- Findings are agent-reported, not independently verified facts.
- Fabric does not automatically merge patches or implement a peer-to-peer debate protocol.
- Telemetry captures public assistant messages and tool metadata, not private thinking. Tool arguments are not streamed into the UI; public results can still contain sensitive data.
- Review the [security notes](SECURITY.md) before installing.

## Other extension configuration

### Project context

| Variable | Default | Meaning |
| --- | --- | --- |
| `PI_TREE_DEPTH` | `2` | Directory depth |
| `PI_TREE_MAX` | `8000` | Maximum tree characters |

Uses `tree` when available, with a `find` fallback. Context is cached until session start/reload or a working-directory change. File names are included in model context; file contents are not read by this extension.

### Recursive context

| Variable | Default | Meaning |
| --- | --- | --- |
| `PI_RECURSIVE_CONTEXT_MAX` | `200000` | Maximum injected characters |
| `PI_RECURSIVE_CONTEXT_NAMES` | `CLAUDE.md,AGENTS.md` | File names in precedence order |

Only files below the working directory are added, avoiding root/ancestor duplication with Pi's loader. Git discovery respects ignored untracked files; tracked files remain eligible. Non-Git fallback ignore support is intentionally limited. This eagerly loads nested instructions—it is not path-scoped lazy loading. Disable it if you want smaller prompts or stricter instruction scoping.

### Cloudflare AI usage

No credentials or personal billing configuration are shipped. Without configured rates, the extension does not fetch billing data or record usage estimates.

Copy [examples/cloudflare-ai-usage.config.json](examples/cloudflare-ai-usage.config.json) to `~/.pi/agent/cloudflare-ai-usage.config.json`, or set `PI_CF_AI_USAGE_CONFIG`. Supply current rates for the models you use. Example figures are illustrative inputs and are **not a promise of current Cloudflare pricing**.

Optional billing lookup reads the environment variables named in that file (by default `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_BILLING_TOKEN`). Use a least-privilege token with appropriate billing-read access. Never commit tokens. Local records are saved to `~/.pi/agent/state/cloudflare-ai-usage.jsonl`.

Estimates reflect messages seen by this installation, not all account traffic. Billing API availability, permissions, reporting delays, and units can vary; the Cloudflare dashboard is authoritative. This is not a billing meter or spending cap.

### Skill-name sanitizer

```text
/sanitize-skills          # preview only
/sanitize-skills apply    # confirm before changing SKILL.md files
```

Scans `~/.agents/skills` and `~/.pi/agent/skills`. The package does not rewrite skills at startup. Back up third-party skills before applying changes. A standalone dry-run is also available:

```sh
bun run extensions/sanitize-skill-names.ts
bun run extensions/sanitize-skill-names.ts --apply
```

### sandbox-dev

A native Pi port of the three ideas behind Claude Code's `sandbox-dev` workflow. The prose lives in `skills/sandbox-dev/SKILL.md`, with `prompts/codePlanner.md`, `prompts/startWork.md`, and `prompts/completeWork.md` as the native `/codePlanner`, `/startWork`, and `/completeWork` commands. The extension supplies the guarantees markdown cannot:

- **Permission floor.** A short allow/confirm/deny policy over `tool_call` and `user_bash`, fail-closed when there is no UI. Patterns are case-insensitive substrings, or `/regex/` when slash-delimited. This is pass 1 only; the shell-safety pass 2 belongs to `extensions/jev` (Phase 5) and may only escalate these verdicts. There is no config file — a project-local file that could zero the `deny` lists would make the floor unenforceable.
- **Conversational plan gate.** `dev_request_approval` reads `taskNotes/<task>/taskFindings.md` from disk and appends the gate to the chat. It records nothing and classifies nothing; the human's reply in the transcript is the record, and the agent reads it. `r` only shows the plan; `/dev-approve` is an explicit human-only approval. The plan review alongside the digest is an ordinary model task, not a Jev judgment.
- **Single-outcome anchoring.** The plan's `Original Ask` becomes the anchored outcome; the supervisor restates it each turn, enforces a turn budget, and stops when `dev_outcome_met` records raw evidence. Budget exhaustion is tracked separately and is not a satisfied outcome.

```text
/dev-approve <task>   # approve a plan and start the implementation
/dev-status           # show the anchored outcome and turn budget
/dev-reset            # clear the in-session gate and anchor
```

This is policy, not a security boundary: a permitted `bash` call can do anything the Pi process can. For real isolation, run Pi in a container or an OS sandbox. Fabric workers run headless with `--no-extensions`, so this extension is not active inside a worker.

## Migrating from loose extension files

1. Finish any running Fabric workers.
2. Back up your existing extensions and configuration.
3. Move personal Fabric and Cloudflare configuration to the external paths described above.
4. Move the old copies of these six extensions **outside** Pi's auto-discovery directories. Do not leave a second `pi-fabric/index.ts` under `~/.pi/agent/extensions/`.
5. Install this package, then `/reload`.

This prevents duplicate tool registrations and repeated prompt injection. Do not remove unrelated extensions such as herdr's integration. Package updates never intentionally modify your personal settings or migrate loose files automatically.

## Updates and removal

Pinned tags do not automatically advance to newer releases. To upgrade, install the new tag explicitly:

```sh
pi install git:github.com/PrashamTrivedi/Prasham-Pi-Extensions@NEW_VERSION
```

For an unpinned development checkout, install without `@v0.1.0` and update with `pi update --extensions`. Git updates may reset and clean the package checkout—never store personal configuration there.

```sh
pi remove git:github.com/PrashamTrivedi/Prasham-Pi-Extensions
```

Reload Pi after removal. User configuration and agent artifacts are retained for deliberate cleanup.

## Development

```sh
git clone https://github.com/PrashamTrivedi/Prasham-Pi-Extensions.git
cd Prasham-Pi-Extensions
npm ci
npm run check                 # TypeScript, Bun tests, package validation
npm run preview               # http://127.0.0.1:4173
```

Install [Bun](https://bun.sh) for tests. Extensions are TypeScript loaded directly by Pi; no production build step is required. Core Pi packages are peer dependencies, not vendored copies. CI uses Node 24 and Bun.

The HTML preview works offline and uses simulated data; it never starts workers or asks for API credentials. Source lives in `extensions/`, tests in `tests/`, previews and guides in `docs/`.

## License

[MIT](./LICENSE) © Prasham Trivedi. Use, modify, and redistribute freely, including commercially; keep the copyright and permission notice in any copy or substantial portion. There is no warranty.
