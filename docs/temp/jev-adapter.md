# Jev adapter for Pi

This adapter has two paths. The bridge invokes the existing Claude Code adapter unchanged; the native path runs `read-budget` in the Pi process.

## Decision mapping

| Decision | What it decides | Claude Code hook today | Pi event | Pi can block / mutate / replace? | Verdict |
|---|---|---|---|---|---|
| shell-safety | destructive or secret-exposing shell command | `PreToolUse` Bash | `tool_call` (`bash`, `powershell`) | block; arguments can mutate | direct bridge port, but `ask` becomes a block because Pi has no permission-hook ask result |
| outbound-leak | whether an MCP/fetch call may send sensitive data | `PreToolUse` MCP/WebFetch | `tool_call` for MCP/custom fetch | block; mutate input | port with behavior change; interactive confirmation would need `ctx.ui.confirm` |
| failure-triage | classify a failed shell command and add repair advice | `PostToolUseFailure` | `tool_result` with `isError`, or `tool_execution_end` observer | replace result, but context is better as appended text | direct content port |
| promise-continue | detect an unfinished promise at stop | `Stop` | `agent_before_settle` | append entry and request one continuation | direct native port; one-shot guard is available |
| read-budget | narrow an unnecessary large file read | `PreToolUse` Read | `tool_call` for `read` | mutate input before validation is not re-run | direct native port; bridge can only rewrite through Claude's envelope |
| mcp-trim | retain relevant pieces of a large MCP result | `PostToolUse` | `tool_result` | replace `content` (and structured content when present) | direct native port; this is a real Pi advantage |
| loop-detector | detect repeated shell/tool patterns | post shell / invocation | `tool_result`, possibly `agent_before_settle` | replace/add context; block only if policy is extended | port with behavior change; Pi has no generic post-tool context-only hook result besides content replacement |
| memory-hygiene | whether a memory/rules write is safe and useful | pre memory/MCP write | `tool_call` for write/edit/MCP | block or mutate | port with behavior change; memory-server specifics need tool naming |
| compact-advisor | advise when context should be compacted | `Stop` | `session_before_compact` (or `agent_before_settle` before a future compaction) | return a custom compaction summary; cannot force `/compact` from lifecycle safely | port with behavior change, and more useful natively |
| screenshot-gate | prevent unsafe screenshot capture | `PreToolUse` screenshot | `tool_call` for a screenshot custom tool | block or mutate | direct only for registered/custom screenshot tools; built-in Pi has no screenshot tool |
| semantic-lint | inspect edited code and advise | `PostToolUse` Edit/Write | `tool_result` for `edit`/`write` | replace content, but should normally append a warning | port with behavior change; content decision, not flow control |
| subagent-router | route subagents to a cheaper model or Pi | `PreToolUse` Agent | `tool_call` for custom subagent tool; no built-in subagent tool in this API | mutate input, including model field if supported | port with behavior change; depends on the custom tool schema |
| injection-screen | flag prompt injection in fetched/read/MCP data | `PostToolUse` | `tool_result` | replace content or append warning | direct and stronger: replacement is visible to the next model request |
| deploy-preflight | check Wrangler account/token before deploy | `PreToolUse` Bash | `tool_call` for `bash` | block; bridge preserves Claude behavior | direct bridge port |
| shell-rules | cheap regex flags used as shell-safety evidence | inside `PreToolUse` shell decision | inside `tool_call` shell-safety | no independent action | direct as a helper, not a standalone event |
| repo-state | summarize git loss risk for shell-safety | synchronous helper in `PreToolUse` | synchronous helper in `tool_call` | no independent action | direct as a helper |
| compact-advisor transcript token reader | infer token pressure and task boundaries | Claude transcript JSONL | `ctx.getContextUsage()` plus `ctx.sessionManager.getBranch()` | can customize compaction, not safely force it | port with behavior change |
| transcript/task context | identify current user request for decisions | `transcript_path` JSONL plus prompt stash | Pi session manager branch/messages; optional external session file | no direct action | cannot be a drop-in port; native adapter should serialize branch entries and use `ctx.getContextUsage()` |

The final two rows are deliberately called out because the harness has 16 named decision/helper files (including `shell-rules` and `repo-state`) but its `DECISIONS` registry contains 14 decision objects. They are not additional Jev questions.

## What this implementation does

* `extensions/jev/index.ts` registers `tool_call` and `tool_result`.
* The bridge creates the Claude `PreToolUse` / `PostToolUse` JSON shape, runs the configured adapter with a hard child-process timeout, and parses `hookSpecificOutput.permissionDecision`, `permissionDecisionReason`, `additionalContext`, and `updatedToolOutput`.
* Bridge process failures, malformed output, non-zero exits, and timeouts fail open. This avoids turning adapter availability into an unconditional Pi outage. When the Claude adapter can reach its own engine but Jev is unreachable, its documented safety fallback still returns `ask`; Pi translates that `ask` to `{ block: true }`, since Pi has no Claude-style “ask the user through the permission protocol” return value. That is an intentional behavior change.
* `extensions/jev/lib/native.ts` invokes the existing `read-budget` decision and mutates the live Pi read input. With a large file, the model receives only the selected `offset`/`limit`; the bridge path cannot do this after Pi validation and cannot directly change the in-process event.
* Configuration is supplied through `JEV_PI_ADAPTER`, `JEV_PI_TIMEOUT_MS`, `JEV_PI_BRIDGE`, and `JEV_PI_NATIVE_READ_BUDGET`. `examples/jev.config.json` records the intended policy and adapter path; copy its values into the environment or a launcher. The Jev decision modes and endpoint remain in `~/.jev-harness/config.json`, so no ledger or credentials are copied into this repository.

## Pi-specific gains and losses

Pi's `tool_call` is in-process: it can block and mutate `event.input`. `tool_result` handlers compose, and can replace `(TextContent | ImageContent)[]`, so mcp-trim and injection-screen can change exactly what the next model sees. `session_before_compact` exposes `CompactionPreparation` and accepts a custom summary. `agent_before_settle` exposes appendable boundary entries and a single continuation. `input`, `user_bash`, provider request, and provider header events provide earlier interception points than Claude hooks. Tool annotations from `pi.getAllTools()` can improve shell risk ranking, although this adapter does not yet override Jev's evidence with annotations.

Pi loses the Claude hook envelope, tool-specific permission protocol, and a guaranteed transcript path. Pi's equivalent is `ctx.sessionManager.getBranch()` / projected session entries plus `ctx.getContextUsage()`. A future native task-context helper should serialize recent branch messages and retain a bounded per-session prompt stash with `pi.appendEntry`; it should not assume `PI_SESSION_FILE` exists. Pi also has no general output-schema enforcement for Jev answers: `tool_result.structuredContent` is only a tool-result field, not a validator for external model judgments. The Jev wire types therefore remain runtime-validated only by decisions and the existing client.

`failure-triage`, `semantic-lint`, `screenshot-gate`, and `repo-state` are not all content-flow decisions. `failure-triage` and `semantic-lint` are useful after `tool_result` because their evidence is the result or edited content. `screenshot-gate` is pre-flow and only useful if a screenshot tool exists. `repo-state` is supporting state for shell-safety, not useful as an independent `tool_result` decision. `injection-screen` is content-oriented and is a strong `tool_result` candidate. `mcp-trim` is the clearest content replacement candidate.

## Migration recommendation

Value per effort, highest first:

1. shell-safety + shell-rules + repo-state + deploy-preflight (already bridgeable and safety-relevant)
2. read-budget (native, high token savings and simple input rewrite)
3. mcp-trim (native replacement with direct context savings)
4. injection-screen (native replacement/warning)
5. promise-continue + loop-detector (native settle boundary, careful one-shot state)
6. failure-triage and semantic-lint (observational content feedback)
7. outbound-leak and memory-hygiene (tool/schema-specific policies)
8. compact-advisor (needs branch serialization and compaction UX policy)
9. subagent-router (depends on custom subagent tools/models)
10. screenshot-gate (only after a screenshot tool is installed)

Use the bridge for an incremental rollout and compatibility with the existing Jev ledger. The permanent home should be native Pi code: it is faster, can replace results safely, and can use Pi's compaction/settle lifecycle. Keep the bridge as a compatibility and rollback path, especially for shell-safety during migration.

## Verification and version skew

The implementation was written against installed Pi 1.2.0 declarations. Those declarations confirm mutable `tool_call`, composable `tool_result`, `session_before_compact`, and `agent_before_settle` results. This repository pins Pi `0.85.1` in `devDependencies`; installed 1.2.0 wins for runtime/API decisions, so this is a version-skew risk. The package must be typechecked against the installed declarations before release. TUI rendering cannot be verified in print mode; a human should run Pi interactively and check blocked shell calls, narrowed reads, and replaced output.
