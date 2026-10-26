import { describe, expect, test } from "bun:test";
import { stripControls } from "../../extensions/btw/text.ts";

describe("stripControls", () => {
  test("removes CSI and OSC sequences", () => {
    expect(stripControls("hello\x1b[2Jworld")).toBe("helloworld");
    expect(stripControls("a\x1b[31mred\x1b[0mb")).toBe("aredb");
    expect(stripControls("a\x1b]0;title\x07b")).toBe("ab");
  });

  test("keeps tabs and newlines and normalizes CRLF", () => {
    expect(stripControls("a\tb\r\nc\rd")).toBe("a\tb\nc\nd");
  });

  test("drops other control bytes", () => {
    expect(stripControls("a\x00b\x07c\x7fd")).toBe("abcd");
  });
});
