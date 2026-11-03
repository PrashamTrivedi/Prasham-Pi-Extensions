import { describe, expect, test } from "bun:test";
import {
  MAX_TRANSCRIPT_CHARS,
  renderTranscript,
  TOOL_ARGS_LIMIT,
  TOOL_RESULT_LIMIT,
  transcriptBudget,
  transcriptFromMessages,
} from "../../extensions/btw/transcript.ts";

const messages = [
  { role: "system", content: "system prompt is not chat" },
  { role: "user", content: "Review the parser" },
  {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "hidden reasoning" },
      { type: "text", text: "Reading the file now." },
      { type: "toolCall", name: "read", arguments: { path: "/repo/a.ts", limit: 20 } },
    ],
  },
  {
    role: "toolResult",
    toolName: "read",
    content: [{ type: "text", text: "export const a = 1;" }],
    isError: false,
  },
  { role: "assistant", content: [{ type: "text", text: "The parser is fine." }] },
];

describe("transcriptFromMessages", () => {
  test("keeps chat text, tool calls, and tool results while skipping system and thinking", () => {
    const blocks = transcriptFromMessages(messages);
    expect(blocks.map((block) => `${block.id} ${block.title}`)).toEqual([
      "m1 User",
      "m2 Assistant",
      "m3 Tool call: read",
      "m4 Tool result: read",
      "m5 Assistant",
    ]);
    expect(blocks[1]!.text).toBe("Reading the file now.");
    expect(blocks[3]!.text).toBe("export const a = 1;");
    expect(blocks.some((block) => block.text.includes("hidden reasoning"))).toBe(false);
    expect(blocks.some((block) => block.text.includes("system prompt"))).toBe(false);
  });

  test("marks failed tool results and keeps image placeholders", () => {
    const blocks = transcriptFromMessages([
      { role: "user", content: [{ type: "text", text: "Look" }, { type: "image", mimeType: "image/png" }] },
      { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "boom" }], isError: true },
    ]);
    expect(blocks[0]!.text).toContain("[image image/png]");
    expect(blocks[1]!.title).toContain("(error)");
    expect(blocks[1]!.isError).toBe(true);
  });

  test("bounds a huge tool result and tool arguments", () => {
    const long = "x".repeat(50_000);
    const blocks = transcriptFromMessages([
      { role: "assistant", content: [{ type: "toolCall", name: "write", arguments: { text: long } }] },
      { role: "toolResult", toolName: "bash", content: [{ type: "text", text: long }] },
    ]);
    expect(blocks[0]!.text.length).toBeLessThanOrEqual(TOOL_ARGS_LIMIT + 80);
    expect(blocks[1]!.text.length).toBeLessThanOrEqual(TOOL_RESULT_LIMIT + 80);
    expect(blocks[1]!.text).toContain("truncated");
  });

  test("ignores malformed entries", () => {
    expect(transcriptFromMessages([null, 42, {}, { role: "unknown" }])).toEqual([]);
  });

  test("strips terminal escapes from chat text", () => {
    const blocks = transcriptFromMessages([{ role: "user", content: "hello\x1b[2Jworld" }]);
    expect(blocks[0]!.text).toBe("helloworld");
  });
});

describe("renderTranscript", () => {
  const blocks = transcriptFromMessages(messages);

  test("returns the newest contiguous blocks and a truncation notice", () => {
    const result = renderTranscript(blocks, 120);
    expect(result.truncated).toBe(true);
    expect(result.dropped).toBeGreaterThan(0);
    expect(result.text.startsWith("[BTW: transcript truncated;")).toBe(true);
    expect(result.text).toContain("The parser is fine.");
    expect(result.text).not.toContain("Review the parser");
    expect(result.kept).toBeLessThan(result.total);
  });

  test("keeps everything when the budget is large", () => {
    const result = renderTranscript(blocks, 100_000);
    expect(result.truncated).toBe(false);
    expect(result.dropped).toBe(0);
    expect(result.kept).toBe(blocks.length);
    expect(result.text).not.toContain("truncated");
  });

  test("keeps the tail of a single block that exceeds the whole budget", () => {
    const result = renderTranscript(blocks, 20);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("[truncated]");
  });

  test("an empty transcript is empty, not a notice", () => {
    const result = renderTranscript([], 1000);
    expect(result.text).toBe("");
    expect(result.total).toBe(0);
  });
});

describe("transcriptBudget", () => {
  test("is positive and capped", () => {
    expect(transcriptBudget({ contextWindow: 64_000, maxTokens: 4_096 })).toBeGreaterThan(2_000);
    expect(transcriptBudget({ contextWindow: 10_000_000, maxTokens: 8_192 })).toBe(MAX_TRANSCRIPT_CHARS);
  });

  test("handles missing metadata", () => {
    expect(transcriptBudget({})).toBeGreaterThan(2_000);
  });
});
