import { describe, expect, test } from "bun:test";
import { denialReason, shortReason, verdictToast } from "../../extensions/workbench/decorate-logic.ts";
import { ansiRow, iconRows, STONES, stoneAt } from "../../extensions/workbench/pet-art.ts";
import { LINES, petLine } from "../../extensions/workbench/pet-lines.ts";
import {
  countErrors,
  isChatty,
  isRealFailure,
  isThirdTurn,
  lineKindFor,
  pushResult,
  signOffLine,
} from "../../extensions/workbench/pet-logic.ts";
import { FALLBACK_SIGN_OFF, SIGN_OFFS, signOffFor, themeOf, THEMED_VERBS } from "../../extensions/workbench/verbs.ts";

describe("isRealFailure", () => {
  test("non-errors never count", () => {
    expect(isRealFailure({ isError: false, text: "Command exited with code 2" })).toBe(false);
    expect(isRealFailure({})).toBe(false);
  });
  test("bare exit code 1 (grep with no match) is benign", () => {
    expect(isRealFailure({ isError: true, text: "Command exited with code 1" })).toBe(false);
    expect(isRealFailure({ isError: true, text: "(no output)\n\nCommand exited with code 1" })).toBe(false);
    expect(isRealFailure({ isError: true, text: "Exit code 1" })).toBe(false);
  });
  test("exit 1 with output, other codes, and tool errors count", () => {
    expect(isRealFailure({ isError: true, text: "error: no such file\n\nCommand exited with code 1" })).toBe(true);
    expect(isRealFailure({ isError: true, text: "Command exited with code 2" })).toBe(true);
    expect(isRealFailure({ isError: true, text: "ENOENT" })).toBe(true);
  });
  test("gate denials are not the pet's failures", () => {
    expect(isRealFailure({ isError: true, text: "sandbox-dev: denied by you" })).toBe(false);
    expect(isRealFailure({ isError: true, text: "jev-gate: no" })).toBe(false);
  });
  test("ring", () => {
    let ring: boolean[] = [];
    for (let i = 0; i < 10; i += 1) ring = pushResult(ring, i % 2 === 0);
    expect(ring).toHaveLength(8);
    expect(countErrors(ring)).toBe(4);
  });
});

describe("lines and moods", () => {
  test("petLine avoids repeating the last line and is deterministic with rng", () => {
    expect(petLine("denied", "", () => 0)).toBe(LINES.denied[0]);
    expect(petLine("denied", LINES.denied[0], () => 0)).toBe(LINES.denied[1]);
  });
  test("line kinds and chatty cadence", () => {
    expect(lineKindFor(85, 0)).toBe("stuffed");
    expect(lineKindFor(10, 3)).toBe("sad");
    expect(lineKindFor(10, 0)).toBe("happy");
    expect(isChatty("sad")).toBe(true);
    expect(isChatty("happy")).toBe(false);
    expect([1, 2, 3, 6].map(isThirdTurn)).toEqual([false, false, true, true]);
  });
});

describe("sign-offs", () => {
  test("themeOf maps every verb to its theme", () => {
    for (const [theme, verbs] of Object.entries(THEMED_VERBS)) for (const verb of verbs) expect(themeOf(verb)).toBe(theme as keyof typeof THEMED_VERBS);
    expect(themeOf("nope")).toBeNull();
  });
  test("signOffFor uses the verb's theme", () => {
    const verb = THEMED_VERBS.barca[0] ?? "";
    expect(SIGN_OFFS.barca).toContain(signOffFor(verb, "", () => 0));
    expect(signOffFor("unknown")).toBe(FALLBACK_SIGN_OFF);
    expect(signOffFor(verb, SIGN_OFFS.barca[0], () => 0)).toBe(SIGN_OFFS.barca[1]);
  });
  test("sign-off line", () => {
    expect(signOffLine("Pressed high", 134_000)).toBe("Pressed high for 2m14s");
  });
});

describe("pixel badges", () => {
  test("every theme is two rows of eight cells", () => {
    for (const theme of ["starwars", "barca", "marvel"] as const) {
      const rows = iconRows(theme);
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row).toHaveLength(8);
    }
    expect(iconRows(null)).toEqual([]);
  });
  test("marvel cycles stones and wraps; others ignore variant", () => {
    expect(iconRows("marvel", 0)[0]?.[2]?.fg).toBe(STONES[0].palette.P);
    expect(iconRows("marvel", 1)[0]?.[2]?.fg).toBe(STONES[1].palette.P);
    expect(stoneAt(STONES.length).name).toBe(STONES[0].name);
    expect(stoneAt(-1).name).toBe(STONES[STONES.length - 1]?.name ?? "");
    expect(iconRows("barca", 3)).toEqual(iconRows("barca", 0));
  });
  test("TIE wings are half-block cells; ansi output is truecolor and reset", () => {
    expect(iconRows("starwars")[0]?.[1]?.glyph).toBe("▄");
    const ansi = ansiRow(iconRows("barca")[0] ?? []);
    expect(ansi).toContain("\x1b[38;2;");
    expect(ansi.endsWith("\x1b[0m")).toBe(true);
  });
});

describe("verdict toasts", () => {
  test("denialReason recognizes gate blocks only", () => {
    expect(denialReason(true, "sandbox-dev: denied by you")).toBe("sandbox-dev: denied by you");
    expect(denialReason(true, "jev-gate: blocked rm")).not.toBeNull();
    expect(denialReason(false, "sandbox-dev: x")).toBeNull();
    expect(denialReason(true, "Command exited with code 2")).toBeNull();
  });
  test("toast is pet-voiced with the owner prefix stripped", () => {
    const toast = verdictToast("sandbox-dev: denied by you", () => 0);
    expect(toast).toBe(`${LINES.denied[0]} denied by you`);
  });
  test("shortReason clips to one line", () => {
    const out = shortReason(`a\n${"b".repeat(200)}`);
    expect(out.length).toBe(90);
    expect(out.endsWith("...")).toBe(true);
    expect(out).not.toContain("\n");
  });
});
