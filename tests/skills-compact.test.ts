import { beforeEach, describe, expect, test } from "bun:test";
import skillsCompact, { compactSkillsBlock, savedPercent, shortenDescription } from "../extensions/skills-compact.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

const block = (entries: Array<{ name: string; description: string; location: string }>) => `prefix
<skills>
The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.
Resolve relative paths against the skill's directory (parent of SKILL.md). Use absolute paths in tool calls.

<available_skills>
${entries.map((entry) => `  <skill>
    <name>${entry.name}</name>
    <description>${entry.description}</description>
    <location>${entry.location}</location>
  </skill>`).join("\n")}
</available_skills>
</skills>
suffix`;

describe("skill descriptions", () => {
  test("a short description is untouched", () => {
    expect(shortenDescription("Read PDFs when the user asks for text.")).toBe("Read PDFs when the user asks for text.");
    expect(shortenDescription("short", 200)).toBe("short");
  });

  test("a long one keeps its first sentence and its trigger sentence", () => {
    const long = `${"Does the thing with files and folders. ".repeat(6)}Use when the user pastes a book or asks for an explainer. ${"More detail that does not route. ".repeat(6)}`;
    const trimmed = shortenDescription(long, 200);
    expect(trimmed.length).toBeLessThanOrEqual(200);
    expect(trimmed).toContain("Does the thing with files and folders.");
    expect(trimmed).toContain("Use when the user pastes a book");
    // A description without a trigger sentence falls back to its first sentence.
    const plain = `${"Words about the skill. ".repeat(20)}`;
    expect(shortenDescription(plain, 120).length).toBeLessThanOrEqual(120);
  });

  test("an entity is never cut in half", () => {
    const escaped = `Cloudflare&apos;s tools ${"and more words here ".repeat(20)}`;
    const trimmed = shortenDescription(escaped, 60);
    expect(trimmed).not.toMatch(/&[a-zA-Z#0-9]*…$/);
    expect(trimmed.endsWith("…")).toBe(true);
  });
});

describe("the available-skills block", () => {
  test("entries collapse to one line and keep name, location and routing text", () => {
    const prompt = block([
      { name: "basin", description: `${"Stream rows into R2 Iceberg tables. ".repeat(8)}Use when the user mentions Basin or pipelines. ${"Extra. ".repeat(30)}`, location: "/root/.pi/agent/skills/basin/SKILL.md" },
      { name: "bookmark", description: "Manage directory bookmarks.", location: "/root/.pi/agent/skills/bookmark/SKILL.md" },
    ]);
    const result = compactSkillsBlock(prompt)!;
    const lines = result.text.split("\n").filter((line) => line.startsWith("<skill "));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('name="basin"');
    expect(lines[0]).toContain('location="/root/.pi/agent/skills/basin/SKILL.md"');
    expect(lines[0]).toContain("Stream rows into R2 Iceberg tables.");
    expect(lines[0]).toContain("Use when the user mentions Basin");
    expect(lines[1]).toBe('<skill name="bookmark" location="/root/.pi/agent/skills/bookmark/SKILL.md">Manage directory bookmarks.</skill>');
    // The instructions and the surrounding prompt are untouched.
    expect(result.text).toContain("The following skills provide specialized instructions");
    expect(result.text).toContain("<available_skills>");
    expect(result.text.startsWith("prefix\n")).toBe(true);
    expect(result.text.endsWith("suffix")).toBe(true);
    expect(result.after).toBeLessThan(result.before);
    expect(savedPercent(result)).toBeGreaterThan(10);
    expect(result.entries).toBe(2);
  });

  test("a prompt without a block or with an empty one is left alone", () => {
    expect(compactSkillsBlock("no skills here")).toBeUndefined();
    expect(compactSkillsBlock("<skills>\nno entries\n</skills>")).toBeUndefined();
    expect(compactSkillsBlock("<available_skills>\n</available_skills>")).toBeUndefined();
    // Missing closing tag: also decline rather than corrupt the prompt.
    expect(compactSkillsBlock("<available_skills>\n  <skill>x</skill>")).toBeUndefined();
  });
});

describe("the extension", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ["PI_SKILLS_COMPACT", "PI_SKILLS_COMPACT_LIMIT"]) {
      if (key in saved) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    }
  });

  function registered() {
    const events = new Map<string, Function>();
    const commands = new Map<string, any>();
    const pi: any = {
      on: (name: string, handler: Function) => events.set(name, handler),
      registerCommand: (name: string, command: any) => commands.set(name, command),
    };
    skillsCompact(pi);
    return { events, commands };
  }

  test("rewrites the system prompt for every turn", () => {
    saved.PI_SKILLS_COMPACT = process.env.PI_SKILLS_COMPACT;
    delete process.env.PI_SKILLS_COMPACT;
    const { events } = registered();
    const prompt = block([{ name: "api", description: "Do the API thing.", location: "/s/api/SKILL.md" }]);
    const result = events.get("before_agent_start")!({ systemPrompt: prompt });
    expect(result.systemPrompt).toContain('<skill name="api"');
    expect(result.systemPrompt).not.toContain("\n    <name>");
    // Nothing to compact: no rewrite at all.
    expect(events.get("before_agent_start")!({ systemPrompt: "plain" })).toBeUndefined();
  });

  test("honours the opt-out switch and reports from the command", async () => {
    saved.PI_SKILLS_COMPACT = process.env.PI_SKILLS_COMPACT;
    process.env.PI_SKILLS_COMPACT = "0";
    const off = registered();
    expect(off.events.has("before_agent_start")).toBe(false);
    delete process.env.PI_SKILLS_COMPACT;
    const on = registered();
    const notified: string[] = [];
    await on.commands.get("skills-compact").handler("", {
      getSystemPrompt: () => block([{ name: "api", description: `${"Long words. ".repeat(40)}`, location: "/s/api/SKILL.md" }]),
      ui: { notify: (message: string) => notified.push(message) },
    });
    expect(notified[0]).toContain("1 entries");
    expect(notified[0]).toContain("saved");
  });
});
