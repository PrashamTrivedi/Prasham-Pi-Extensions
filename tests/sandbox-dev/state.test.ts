import { describe, expect, test } from "bun:test";
import { extractOutcome, extractSection } from "../../extensions/sandbox-dev/state.ts";

describe("extractOutcome", () => {
  test("captures the Original Ask section only", () => {
    const plan = ["# Task", "", "## Original Ask", "Add a widget.", "With tests.", "", "## Complexity", "3"].join("\n");
    expect(extractOutcome(plan)).toBe("Add a widget.\nWith tests.");
  });

  test("returns empty when absent", () => {
    expect(extractOutcome("# Task\n\n## Complexity\n3")).toBe("");
    expect(extractOutcome("")).toBe("");
  });

  test("keeps headings that are inside a fenced block", () => {
    const plan = [
      "## Original Ask",
      "Quote the ticket:",
      "",
      "```markdown",
      "# Ticket 88",
      "## Acceptance",
      "- done",
      "```",
      "",
      "Tail of the ask.",
      "",
      "## Complexity",
      "4",
    ].join("\n");
    const outcome = extractOutcome(plan);
    expect(outcome).toContain("# Ticket 88");
    expect(outcome).toContain("Tail of the ask.");
    expect(outcome).not.toContain("## Complexity");
  });

  test("stops at the next heading of the same or higher level", () => {
    const plan = ["# Title", "## Original Ask", "Do it.", "### Detail", "Keep me.", "## Next", "Drop me."].join("\n");
    expect(extractOutcome(plan)).toBe("Do it.\n### Detail\nKeep me.");
  });
});

describe("extractSection", () => {
  test("returns the body of the matching heading", () => {
    const markdown = ["# A", "## Acceptance Criteria", "1. One", "2. Two", "## Validation", "run it"].join("\n");
    expect(extractSection(markdown, /acceptance criteria/i)).toBe("1. One\n2. Two");
  });

  test("ignores headings inside fences", () => {
    const markdown = ["## Acceptance Criteria", "```", "## Not a heading", "```", "- real", "## End"].join("\n");
    expect(extractSection(markdown, /acceptance/i)).toBe("```\n## Not a heading\n```\n- real");
  });
});
