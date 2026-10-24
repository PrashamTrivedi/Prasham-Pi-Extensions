# Review passes — sandbox-prompts

## Pass 1 — 4 findings (all fixed except #3, surfaced)

1. **`policy.ts` `matchCommand` doc claimed too much.** It said `grep curl` stops matching; a
   whole-token mention still matches. The real reason the noise disappears is that `curl`,
   `wget`, and the install commands left the confirm list. Comment rewritten to say exactly that.
2. **Dead rule `npm deploy`.** No such npm command, and `npm run deploy` does not match the
   pattern, so the entry was inert noise added while "publish/deploy" was expanded. Removed; the
   four real `* publish` patterns remain.
3. **Credential reads are now silent.** `~/.claude/.credentials.json`, `~/.pi/agent/auth.json`,
   `~/.config/gh/hosts.yml` are readable without a prompt because reads never confirm. The deny
   list already covered `.aws`, `.ssh`, `.npmrc`, `.netrc`, `.git-credentials` but not these.
   **Surfaced, not fixed** — widening `deny` is outside `Original Ask` and changes the floor for
   every project; it needs its own plan.
4. **Counter semantics were implicit.** `confirm(s)` counts pass-1 confirm verdicts, including
   shell ones Jev then auto-approves; `auto-approved (Jev)` counts only those shell
   auto-approvals. Documented in `extensions/sandbox-dev/README.md` rather than relabelled, so the
   line stays short.

## Pass 2 — 0 findings

Verified the fixed comment, the trimmed list, `isUnderAnyRoot` normalization
(`~/.pi/agent/../../etc/passwd` resolves out of the root and confirms), relative escape
(`../x` → confirm), deny-before-allow-root ordering, and that `jev-gate` still evaluates every
`tool_call` independently so a pass-1 `allow` is not an unpoliced command.

**Terminated by zero findings.**

## Security review (diff-level)

- **Auth / authorization:** no change to the plan gate or `dev_outcome_met`; `dev_request_approval`
  and `dev_outcome_met` are still exempt from the floor.
- **Credentials / secrets:** deny list unchanged and still consulted before the write-allow-root
  check, so a protected name inside `/tmp` still denies (covered by a new test). Finding #3 above is
  the one open gap.
- **Injection:** new regexes are built from escaped literals; only slash-delimited patterns are raw
  regexes, as before. No `eval`, no shell interpolation added.
- **Deserialization / DOM escapes:** not applicable.
