/**
 * Themed working verbs for the pet. Kept pure so rotation and theme pinning are
 * unit-testable; the extension picks the current turn's verb every turn.
 */
export type PetTheme = "auto" | "starwars" | "marvel" | "barca";

export const PET_THEMES: readonly PetTheme[] = ["auto", "starwars", "marvel", "barca"];

export const THEMED_VERBS: Record<Exclude<PetTheme, "auto">, readonly string[]> = {
  starwars: [
    "Consulting the Force",
    "Jumping to hyperspace",
    "Calibrating the hyperdrive",
    "Evading TIE fighters",
    "Scanning for droids",
    "Rendezvous with the fleet",
    "Charging the turbolasers",
    "Decoding the Holocron",
    "Threading the asteroid field",
    "Raising the shields",
  ],
  marvel: [
    "Assembling the team",
    "Charging the arc reactor",
    "Hulking out",
    "Web-slinging through files",
    "Summoning lightning",
    "Opening the Bifrost",
    "Running the gauntlet",
    "Suiting up",
    "Firing the repulsors",
    "Rewinding the Time Stone",
  ],
  barca: [
    "Tiki-taka in midfield",
    "Pressing high",
    "La Masia build-up",
    "One-touch passing",
    "Gegenpressing",
    "Positional play",
    "Third-man runs",
    "Overloading the wing",
    "The Cruyff turn",
    "Playing total football",
  ],
};

export function isPetTheme(value: string): value is PetTheme {
  return (PET_THEMES as readonly string[]).includes(value);
}

export function verbsFor(theme: PetTheme): readonly string[] {
  if (theme === "auto") {
    return [...THEMED_VERBS.starwars, ...THEMED_VERBS.marvel, ...THEMED_VERBS.barca];
  }
  return THEMED_VERBS[theme];
}

/** Deterministic per-turn rotation, stable for a given turn and theme. */
export function pickVerb(theme: PetTheme, turn: number): string {
  const verbs = verbsFor(theme);
  const safeTurn = Number.isFinite(turn) ? Math.trunc(turn) : 0;
  const index = ((safeTurn % verbs.length) + verbs.length) % verbs.length;
  return verbs[index];
}

// --- Turn sign-offs (ported from the Claude Code mod; each reads before ` for 2m14s`) -------------

export const SIGN_OFFS: Record<Exclude<PetTheme, "auto">, readonly string[]> = {
  starwars: [
    "Trained on Dagobah",
    "Made the Kessel Run",
    "Used the Force",
    "Dodged the TIE fighters",
    "Restored balance",
    "Jumped to lightspeed",
    "Escaped the Death Star",
  ],
  marvel: ["Assembled", "Suited up", "Went quantum", "Wielded Mjolnir", "Snapped back", "Opened the portal", "Held the line"],
  barca: [
    "Played tiki-taka",
    "Pressed high",
    "Threaded the through-ball",
    "Rondo'd in midfield",
    "Played La Masia style",
    "Won the midfield",
    "Triangulated the play",
  ],
};

export const FALLBACK_SIGN_OFF = "Pip finished";

/** The theme a sampled verb belongs to, or null for an unknown or empty verb. */
export function themeOf(verb: string): Exclude<PetTheme, "auto"> | null {
  for (const theme of ["starwars", "marvel", "barca"] as const) {
    if (THEMED_VERBS[theme].includes(verb)) return theme;
  }
  return null;
}

/** A sign-off for the verb's theme that is not `last` when another exists. `rng` is injectable. */
export function signOffFor(verb: string, last = "", rng: () => number = Math.random): string {
  const theme = themeOf(verb);
  if (theme === null) return FALLBACK_SIGN_OFF;
  const all = SIGN_OFFS[theme];
  const pool = all.filter((line) => line !== last);
  const from = pool.length > 0 ? pool : all;
  return from[Math.floor(rng() * from.length)] ?? FALLBACK_SIGN_OFF;
}
