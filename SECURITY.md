# Security and operational boundaries

Pi extensions execute code with your user account's permissions. Review the source before installing. This package is not a security sandbox.

## Fabric

- Workers inherit the environment and model authentication available to Pi. They may read files, make network requests, and execute commands. The current launch uses Pi's approval flag for unattended work; use only on trusted tasks and repositories.
- Git worktrees isolate checkouts, not permissions. They share repository metadata and do not protect other host paths or external services.
- Model hierarchy controls delegation choices, not OS-level authorization. Same-model recursion can create many tasks; concurrency is bounded but total tokens, total work, disk usage, and spending are not capped.
- Public assistant text, results, patches, and stderr logs may contain sensitive data. Telemetry strips terminal controls and bounds previews; it does not guarantee secret redaction.
- Temporary files are not durable backups. Review and archive results you need before cleaning up. Do not share entire temporary run directories without inspection.
- Cancellation is best effort. External side effects and subprocesses may already have occurred. Review actual process and worktree state before cleanup.
- Inspect patches and rerun relevant tests before applying changes. The extension does not validate model conclusions or automatically merge worker changes.

## Context extensions

Project-context sends directory names to the selected model. Recursive-context sends nested instruction-file contents from trusted projects, potentially increasing token usage and introducing conflicting instructions. It skips resolved paths outside the working directory. Git-tracked instruction files remain eligible even when matching an ignore pattern. Disable either extension through `pi config` if this behavior is unsuitable.

## Cloudflare usage

Configuration contains environment variable names, not credentials. Use a least-privilege billing token and keep it in your environment or secret manager. Estimates are not spending limits or authoritative billing. No billing lookup occurs without configured model rates. When configured, billing queries are sent to Cloudflare's API; local usage records stay on disk.

## Sanitizer

Loading the extension never modifies skills. `/sanitize-skills` previews; `/sanitize-skills apply` asks for confirmation. The standalone `--apply` flag is explicit consent to write. Back up third-party skills first. Changes affect frontmatter names, not an upstream package release.

## Reporting issues

Do not post credentials, private prompts, or raw agent logs in public issues. Use GitHub private vulnerability reporting for sensitive reports if enabled on the repository. Otherwise contact the repository owner privately before sharing sensitive details.
