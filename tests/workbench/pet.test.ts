import { describe, expect, test } from "bun:test";
import { isPetTheme, pickVerb, THEMED_VERBS, verbsFor } from "../../extensions/workbench/verbs.ts";
import { moodFrom } from "../../extensions/workbench/pet.ts";

describe("verbs", () => {
  test("auto combines every theme", () => {
    expect(verbsFor("auto")).toHaveLength(
      THEMED_VERBS.starwars.length + THEMED_VERBS.marvel.length + THEMED_VERBS.barca.length,
    );
    expect(verbsFor("auto").length).toBe(30);
  });

  test("a pinned theme only returns its own verbs", () => {
    for (const verb of verbsFor("barca")) expect(THEMED_VERBS.barca).toContain(verb);
  });

  test("pickVerb is deterministic and rotates", () => {
    expect(pickVerb("marvel", 0)).toBe(THEMED_VERBS.marvel[0]);
    expect(pickVerb("marvel", 0)).toBe(pickVerb("marvel", 0));
    expect(pickVerb("marvel", 1)).not.toBe(pickVerb("marvel", 0));
    expect(pickVerb("marvel", THEMED_VERBS.marvel.length)).toBe(THEMED_VERBS.marvel[0]);
    expect(pickVerb("marvel", Number.NaN)).toBe(THEMED_VERBS.marvel[0]);
  });

  test("isPetTheme", () => {
    expect(isPetTheme("starwars")).toBe(true);
    expect(isPetTheme("nope")).toBe(false);
  });
});

describe("moodFrom", () => {
  test("climbs with context pressure and errors", () => {
    expect(moodFrom(null, 0)).toBe("calm");
    expect(moodFrom(30, 0)).toBe("focused");
    expect(moodFrom(60, 0)).toBe("busy");
    expect(moodFrom(90, 0)).toBe("strained");
    expect(moodFrom(10, 1)).toBe("strained");
  });
});
