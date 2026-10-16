# Changelog

## Unreleased

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
