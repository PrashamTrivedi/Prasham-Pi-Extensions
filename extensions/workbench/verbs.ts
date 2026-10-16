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
