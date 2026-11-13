import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readIndex, searchLocal } from "../../extensions/memory/search.ts";

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-memory-search-"));
  writeFileSync(join(dir, "MEMORY.md"), [
    "# Memory Index",
    "",
    "- [project_release.md](project_release.md) — release checklist",
    "- [next_handoff.md](next_handoff.md) — release blockers in flight",
    "- [feedback_tone.md](feedback_tone.md) — keep replies short",
    "- [reference_docs.md](reference_docs.md) — external dashboards",
    "",
  ].join("\n"));
  writeFileSync(join(dir, "project_release.md"), "---\nname: Release checklist\ndescription: how to cut a release\ntype: project\n---\n\nSteps.\n");
  writeFileSync(join(dir, "next_handoff.md"), "---\nname: Handoff\ndescription: release blockers in flight\ntype: next\n---\n\nWaiting.\n");
  writeFileSync(join(dir, "feedback_tone.md"), "---\nname: Tone\ndescription: keep replies short\ntype: feedback\n---\n\nDuring release week, be brief about the release notes.\n");
  writeFileSync(join(dir, "reference_docs.md"), "---\nname: Dashboards\ndescription: external dashboards\ntype: reference\n---\n\nNothing here.\n");
  return dir;
}

test("a name hit outranks a description hit, and a body hit reports its line", () => {
  const dir = fixture();
  try {
    const hits = searchLocal(dir, "release");
    expect(hits.map((hit) => hit.file)).toEqual(["project_release.md", "next_handoff.md", "feedback_tone.md"]);
    expect(hits.map((hit) => hit.score)).toEqual([0, 1, 2]);
    expect(hits[0]!.description).toBe("how to cut a release");
    // Only the body hit carries an excerpt, and the excerpt carries the match.
    expect(hits[0]!.line).toBeUndefined();
    expect(hits[1]!.line).toBeUndefined();
    expect(hits[2]!.line).toContain("release week");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the index supplies a description when a file has no frontmatter", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-memory-search-"));
  try {
    writeFileSync(join(dir, "MEMORY.md"), "# Memory Index\n\n- [next_plain.md](next_plain.md) — the open threads\n");
    writeFileSync(join(dir, "next_plain.md"), "# Plain\n\nNothing structured here.\n");
    const hits = searchLocal(dir, "threads");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.title).toBe("next_plain");
    expect(hits[0]!.description).toBe("the open threads");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("search is case-insensitive, bounded to the asked directory, and quiet when empty", () => {
  const dir = fixture();
  try {
    expect(searchLocal(dir, "RELEASE")).toHaveLength(3);
    expect(searchLocal(dir, "   ")).toEqual([]);
    expect(searchLocal(dir, "no such memory")).toEqual([]);
    expect(searchLocal(join(dir, "missing"), "release")).toEqual([]);
    // MEMORY.md is the index, never a hit of its own.
    expect(searchLocal(dir, "release").map((hit) => hit.file)).not.toContain("MEMORY.md");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the index parser accepts em dashes and plain hyphens", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-memory-search-"));
  try {
    writeFileSync(join(dir, "MEMORY.md"), [
      "# Memory Index",
      "- [a.md](a.md) — em dash",
      "- [b.md](b.md) - plain hyphen",
      "- malformed line",
    ].join("\n"));
    const index = readIndex(dir);
    expect(index.get("a.md")).toBe("em dash");
    expect(index.get("b.md")).toBe("plain hyphen");
    expect(index.size).toBe(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
