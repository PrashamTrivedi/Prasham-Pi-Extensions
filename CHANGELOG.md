# Changelog

## Unreleased

- **Fabric shows the whole run, not a pane.** Each child now persists a real Pi session (`--session-dir .../sessions --session-id <agent-id>`) instead of running ephemeral, and `Enter` in `/team` replays that transcript in a full-window view: user/assistant text, thinking, tool calls, and tool results, with paging and a live refresh while the run still works. The compact `◆ PI FABRIC` panel is gone; the accent status line is the only persistent surface (`/team hide` / `/team show` now toggle it). Finished runs leave the live list and `/team` view five minutes after `finishedAt`; pruning is display-only, so `agent_status`, result cards, and the saved transcript keep working, and `/team all` (or `a` in the inspector) lists them again.
- **MIT license.** Added `LICENSE`; `package.json` is `MIT`; the README states the credit and notice requirement.
- **Duck now mimics Claude Code's question flow.** The model returns a JSON array of questions (`header`, `question`, `options`, `allowOther`); the parser is tolerant (fences, prose, clamping to 4 questions and 4 options) and falls back to raw text. `/duck answer` opens a shared AskUserQuestion-style questionnaire and writes the answers into the editor for review; it never auto-sends and preserves an existing draft.
- **Cockpit and duck are docked, not floating.** Both moved from `ctx.ui.custom({ overlay: true })` to a `setWidget(..., { placement: "aboveEditor" })` panel that reserves layout space instead of covering the transcript. The cockpit collapses to one line below 60 columns, since widgets have no `visible(width)` gate.
- **Fabric: unrecorded models are unrestricted.** A model absent from the hierarchy may be spawned from any caller and may delegate to any model; ranks only order delegation among named models. A `/reload` now re-applies an edited hierarchy to the existing root, so a new session is no longer required.
- **Cloudflare AI usage is kept, not retired.** It renders only while a `cloudflare-workers-ai` model is active and clears otherwise, so it and `usage/` never compete for the status line.
- **One documentation guide per extension** under `docs/`, linked from the README.
- Native `sandbox-dev` port: `skills/sandbox-dev/SKILL.md`, the `prompts/codePlanner.md`, `prompts/startWork.md`, and `prompts/completeWork.md` templates, and the `extensions/sandbox-dev` extension.
- Minimal permission floor: allow/confirm/deny rules over `tool_call` and `user_bash`, fail-closed without UI, built in with no config file. Shell-safety pass 2 is deferred to `extensions/jev` and may only escalate.
- Conversational plan gate (`dev_request_approval`, `/dev-approve`): `dev_request_approval` reads the plan and appends the gate to the chat. The human's reply in the transcript is the record; the extension records no approval and does not classify or intercept the reply. `/dev-approve` is an explicit human command that anchors the outcome and starts `/startWork`.
- Single-outcome supervision with a turn budget (`dev_outcome_met`); supervision arms on the first source write, and budget exhaustion is tracked separately and is not reported as met.
- Unit and wiring tests for the permission floor, `strongest()` escalation, the conversational gate, and outcome supervision.

## 0.1.0

Initial Git-installable package under PrashamTrivedi/Prasham-Pi-Extensions.

- Fabric recursive delegation with configurable same-or-lower model ranks.
- Compact live widget, responsive comparison cards, and framed team inspector.
- Portable external configuration and explicit worker extension loading.
- Launch-baseline patch capture including non-ignored new files, without altering worker staging.
- Project and nested instruction context helpers.
- Opt-in configured Cloudflare usage estimates and optional billing lookup.
- Skill-name preview and explicitly confirmed corrections; no startup writes.
- Illustrative SVG/PNG and offline interactive HTML preview.
- Automated tests and CI. License selection pending.
