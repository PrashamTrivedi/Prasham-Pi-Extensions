# Changelog

## Unreleased

- Native `sandbox-dev` port: `skills/sandbox-dev/SKILL.md`, the `prompts/codePlanner.md`, `prompts/startWork.md`, and `prompts/completeWork.md` templates, and the `extensions/sandbox-dev` extension.
- Minimal permission model: allow/confirm/deny rules over `tool_call` and `user_bash`, fail-closed without UI, configured by `sandbox-dev.json`.
- Hash-bound explicit plan approval (`dev_request_approval`, `/dev-approve`) and single-outcome supervision with a turn budget (`dev_outcome_met`).
- Unit and wiring tests for the policy, approval/outcome state, and the permission gate.

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
