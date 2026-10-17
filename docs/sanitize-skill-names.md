# Skill-name sanitizer

Rewrites the `name:` field in `SKILL.md` frontmatter so Pi's skill loader accepts third-party
skill packs whose names use characters outside `^[a-z0-9-]+$` (for example `stitch::` or
`react:` prefixes).

## Commands

| Command | Purpose |
| --- | --- |
| `/sanitize-skills` | Preview proposed corrections |
| `/sanitize-skills apply` | Write the corrections |

## Notes

- **Nothing is written at load time.** A preview runs first; writes require the explicit
  `apply` argument.
- The rewrite is idempotent and self-heals if an upstream pack re-syncs invalid names.
- It also runs standalone: `bun run extensions/sanitize-skill-names.ts [--apply]`.
- Only the `name` frontmatter line of skills Pi auto-discovers is touched.
