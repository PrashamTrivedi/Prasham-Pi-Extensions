// Sanitize the `name` field in SKILL.md frontmatter so pi's skill loader accepts
// third-party skills installed under ~/.agents/skills/ (e.g. the Stitch skill
// pack, which uses `stitch::` / `react:` namespace prefixes that violate pi's
// `^[a-z0-9-]+$` name rule).
//
// This is a pi-only concern: it runs as a pi extension (auto-loaded from
// ~/.pi/agent/extensions/) and only ever touches the `name:` frontmatter line
// of skills pi auto-discovers. It is idempotent — re-running is a no-op once
// names are valid, and it self-heals if the upstream skill pack re-syncs with
// invalid names.
//
// Dual-use:
//   1. Run /sanitize-skills (preview); /sanitize-skills apply confirms writes.
//   2. Run manually: bun run extensions/sanitize-skill-names.ts [--apply]
// No files are changed automatically when the package is loaded.
//
// If pi scans skills before loading extensions on a given startup, the fix
// applies on the next restart — hence the standalone mode for a one-shot fix.

import { existsSync, readdirSync, readFileSync, writeFileSync, lstatSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { homedir } from "node:os";

// Skill roots pi auto-discovers. We only sanitize these, never arbitrary trees.
const SKILL_DIRS = [
  join(homedir(), ".agents", "skills"),
  join(homedir(), ".pi", "agent", "skills"),
];

// pi name rules: lowercase a-z, 0-9, hyphens; no leading/trailing/consecutive
// hyphens; 1-64 chars.
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function sanitize(raw: string, fallback: string): string {
  let s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // runs of invalid chars -> single hyphen
    .replace(/^-+|-+$/g, "") // strip leading/trailing hyphens
    .replace(/-{2,}/g, "-"); // collapse any leftover doubles
  if (!s) {
    s = fallback
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  if (s.length > 64) s = s.slice(0, 64).replace(/-+$/, "");
  return s;
}

function findSkillFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const p = join(dir, entry);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const skill = join(p, "SKILL.md");
    if (existsSync(skill) && !lstatSync(skill).isSymbolicLink()) {
      out.push(skill);
    } else {
      findSkillFiles(p, out); // recurse into nested dirs
    }
  }
  return out;
}

// Matches a YAML `name:` scalar line inside frontmatter (quoted or unquoted).
const NAME_LINE_RE = /^(\s*name:\s*)(["']?)([^"'#\n]+?)\2(\s*(?:#.*)?)$/m;

type Patch = { file: string; from: string; to: string };

function patchFile(file: string, fallback: string, apply: boolean): Patch | null {
  const src = readFileSync(file, "utf8");
  if (!src.startsWith("---")) return null;
  const end = src.indexOf("\n---", 3);
  if (end === -1) return null;
  const fm = src.slice(0, end);
  const rest = src.slice(end);

  const m = fm.match(NAME_LINE_RE);
  if (!m) return null;
  const [, prefix, quote, value, trailing] = m;
  const current = value.trim();
  if (NAME_RE.test(current) && current.length <= 64) return null;

  const fixed = sanitize(current, fallback);
  if (fixed === current) return null;

  const newFm = fm.replace(
    NAME_LINE_RE,
    `${prefix}${quote}${fixed}${quote}${trailing}`,
  );
  if (newFm === fm) return null;
  if (apply) writeFileSync(file, newFm + rest, "utf8");
  return { file, from: current, to: fixed };
}

export function run(apply = false): { patched: Patch[]; checked: number } {
  const patched: Patch[] = [];
  let checked = 0;
  for (const dir of SKILL_DIRS) {
    for (const file of findSkillFiles(dir)) {
      checked++;
      const fallback = file.split("/").slice(-2, -1)[0] ?? "skill";
      const res = patchFile(file, fallback, apply);
      if (res) patched.push(res);
    }
  }
  return { patched, checked };
}

// Loading the package only registers a command; it never rewrites skills.
export default function (pi: ExtensionAPI) {
  pi.registerCommand("sanitize-skills", {
    description: "Preview invalid skill names; use apply to confirm corrections",
    handler: async (args, ctx) => {
      const preview = run();
      if (args.trim() === "apply" && preview.patched.length) {
        if (!ctx.hasUI) throw new Error("Use the standalone --apply command for explicit headless writes.");
        if (!await ctx.ui.confirm("Update skill names?", `${preview.patched.length} SKILL.md files will be modified. Back up third-party skills first.`)) return;
        const result = run(true);
        ctx.ui.notify(`Updated ${result.patched.length} skill names. /reload to rescan.`, "info");
      } else {
        ctx.ui.notify(preview.patched.map(p => `${p.file}: ${p.from} → ${p.to}`).join("\n") || `No invalid names (${preview.checked} skills checked).`, "info");
      }
    },
  });
}

// --- standalone script entrypoint ---
if (import.meta.main) {
  const apply = process.argv.includes("--apply");
  const { patched, checked } = run(apply);
  if (patched.length === 0) {
    console.log(`No invalid skill names found (${checked} skill(s) checked).`);
  } else {
    for (const p of patched) {
      console.log(`${apply ? "patched" : "would patch"} ${p.file}: "${p.from}" -> "${p.to}"`);
    }
    console.log(apply ? `\n${patched.length} skill name(s) fixed. Reload pi to rescan.` : "\nPreview only. Pass --apply to write changes.");
  }
}
