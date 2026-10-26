import { afterEach, describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  beginFullScreen,
  currentScreenDepth,
  endFullScreen,
  fitScreen,
  fullScreenOpen,
  FABRIC_AGENTS_WIDGET,
  PI_FOOTER_ROWS,
  resetScreenDepth,
  windowHeight,
} from "../../extensions/shared/full-screen.ts";

afterEach(() => {
  resetScreenDepth();
});

describe("windowHeight", () => {
  test("leaves room for Pi's footer and keeps a usable minimum", () => {
    expect(PI_FOOTER_ROWS).toBe(3);
    expect(windowHeight(30)).toBe(27);
    expect(windowHeight(5)).toBe(8);
  });
});

describe("fitScreen", () => {
  test("pads short screens and trims long ones", () => {
    expect(fitScreen(["a"], 3, 10)).toEqual(["a", "", ""]);
    expect(fitScreen(["a", "b", "c", "d"], 2, 10)).toEqual(["a", "b"]);
  });

  test("truncates lines to the width", () => {
    const [line] = fitScreen(["abcdefghij"], 1, 4);
    expect(visibleWidth(line!)).toBeLessThanOrEqual(4);
    expect(line).not.toBe("abcdefghij");
  });
});

describe("full-screen lock", () => {
  test("counts nested screens and never goes negative", () => {
    resetScreenDepth();
    expect(fullScreenOpen()).toBe(false);
    beginFullScreen();
    beginFullScreen();
    expect(currentScreenDepth()).toBe(2);
    expect(fullScreenOpen()).toBe(true);
    endFullScreen();
    expect(fullScreenOpen()).toBe(true);
    endFullScreen();
    expect(fullScreenOpen()).toBe(false);
    endFullScreen();
    expect(currentScreenDepth()).toBe(0);
  });

  test("exports the Fabric widget key", () => {
    expect(FABRIC_AGENTS_WIDGET).toBe("pi-fabric-agents");
  });
});
