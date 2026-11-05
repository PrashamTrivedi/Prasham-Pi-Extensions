import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mirrorPath, mirrorTranscript, piEntryToClaude } from "../../extensions/shared/jev-transcript.ts";

const temp = () => mkdtempSync(join(tmpdir(), "jev-transcript-"));

describe("the Pi session is mirrored in the Claude transcript shape", () => {
  test("conversation turns convert, with Pi usage names mapped to Claude ones", () => {
    const user = { type: "message", message: { role: "user", content: "first ask" } };
    const assistant = {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "the answer" }],
        usage: { input: 120_000, output: 12, cacheRead: 5_000, cacheWrite: 0, total: 137_012 },
      },
    };
    expect(JSON.parse(piEntryToClaude(user)!)).toEqual({ type: "message", message: { role: "user", content: "first ask" } });
    const converted = JSON.parse(piEntryToClaude(assistant)!);
    expect(converted.message.content).toBe("the answer");
    expect(converted.message.usage).toEqual({
      input_tokens: 120_000,
      output_tokens: 12,
      cache_read_input_tokens: 5_000,
      cache_creation_input_tokens: 0,
    });
    // Tool results, system prompts and blank turns carry no conversation.
    expect(piEntryToClaude({ type: "message", message: { role: "toolResult", content: [{ type: "text", text: "ok" }] } })).toBeUndefined();
    expect(piEntryToClaude({ type: "message", message: { role: "system", content: "prompt" } })).toBeUndefined();
    expect(piEntryToClaude({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", name: "read" }] } })).toBeUndefined();
    expect(piEntryToClaude({ type: "model_change", provider: "p", modelId: "m" })).toBeUndefined();
    expect(piEntryToClaude("not an object")).toBeUndefined();
  });

  test("a session file is mirrored incrementally and restarts when the file changes", () => {
    const root = temp();
    const source = join(root, "session.jsonl");
    const first = `${JSON.stringify({ type: "message", message: { role: "user", content: "first ask" } })}\n`;
    writeFileSync(source, first);
    try {
      const one = mirrorTranscript("s-1", { source, root })!;
      expect(one.path).toBe(mirrorPath("s-1", root));
      expect(readFileSync(one.path, "utf8").split("\n").filter(Boolean)).toHaveLength(1);
      expect(one.lines).toBe(1);

      // Appending reads only the new bytes: a second turn lands in the mirror.
      appendFileSync(source, `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: { input: 9 } } })}\n`);
      const two = mirrorTranscript("s-1", { source, root, previous: one })!;
      expect(two.cursor).toBeGreaterThan(one.cursor);
      const lines = readFileSync(two.path, "utf8").split("\n").filter(Boolean);
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[1]!).message.usage.input_tokens).toBe(9);
      expect(two.lines).toBe(2);

      // No new bytes: the previous state is returned untouched.
      const three = mirrorTranscript("s-1", { source, root, previous: two });
      expect(three).toEqual(two);

      // A different session file starts the mirror over.
      const other = join(root, "other.jsonl");
      writeFileSync(other, `${JSON.stringify({ type: "message", message: { role: "user", content: "other ask" } })}\n`);
      const restarted = mirrorTranscript("s-1", { source: other, root, previous: two })!;
      expect(restarted.cursor).toBeLessThanOrEqual(two.cursor);
      expect(readFileSync(restarted.path, "utf8")).toContain("other ask");
      expect(readFileSync(restarted.path, "utf8")).not.toContain("first ask");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("an ephemeral session mirrors its in-memory branch instead of a file", () => {
    const root = temp();
    try {
      const entries = [
        { type: "message", message: { role: "user", content: "no file here" } },
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "answer" }], usage: { input: 1000, cacheRead: 200 } } },
      ];
      const mirror = mirrorTranscript("s-2", { entries, root })!;
      expect(readFileSync(mirror.path, "utf8")).toContain("no file here");
      expect(JSON.parse(readFileSync(mirror.path, "utf8").trim().split("\n")[1]!).message.usage).toEqual({
        input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 200, cache_creation_input_tokens: 0,
      });
      // Nothing to mirror and nothing before: stay undefined instead of writing an empty file.
      expect(mirrorTranscript("s-3", { entries: [], root })).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
