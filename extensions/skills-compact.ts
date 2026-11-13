/**
 * `skills-compact` — shrink the injected skill list without dropping a skill.
 *
 * Pi advertises every skill as a five-line XML entry plus its full frontmatter
 * description (up to 1,024 chars). Measured on a real provider payload, that block
 * was 20,106 chars ≈ 4,721 tokens — the largest removable slice of the fixed prompt.
 *
 * This extension rewrites the `<available_skills>` block the moment Pi builds the
 * system prompt:
 *   - each entry becomes one line (`<skill name="…" location="…">description</skill>`),
 *     which keeps the standard's fields while dropping ~76 chars of indentation/tags;
 *   - a description longer than the limit is cut to its first sentence plus the
 *     sentence that says when to use it, so routing survives;
 *   - names, locations and the surrounding instructions are untouched, so the model
 *     can still read every `SKILL.md` and `/skill:name` keeps working.
 *
 * `PI_SKILLS_COMPACT=0` disables it, `PI_SKILLS_COMPACT_LIMIT` sets the description
 * cap (default 200 chars), and `/skills-compact` reports the saving.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Description cap that keeps a "what" and a "when" sentence. */
export const DEFAULT_DESCRIPTION_LIMIT = 200;

const ROUTING = /use (this|when|for|it when)|trigger|when the user|when you|for requests|use whenever/i;

/** Cuts at a word (never an XML entity) and marks the loss. */
function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, Math.max(1, limit - 1)).replace(/[\s,;:]+$/, "");
  // Do not leave half an entity like `&quo` behind: it would corrupt escaped text.
  const entity = cut.match(/&[a-zA-Z#0-9]*$/);
  const safe = entity ? cut.slice(0, cut.length - entity[0].length).replace(/[\s,;:]+$/, "") : cut;
  return `${safe}…`;
}

/**
 * Keeps a long description's first sentence plus its routing sentence, then caps it.
 * Already-short descriptions pass through byte-identical.
 */
export function shortenDescription(description: string, limit = DEFAULT_DESCRIPTION_LIMIT): string {
  const text = description.trim();
  if (text.length <= limit || limit < 1) return text;
  const parts = text.match(/[^.!?]+[.!?]+["'\u201d]?|\S[^.!?]*$/g) ?? [text];
  const first = (parts[0] ?? "").trim();
  const routing = parts.slice(1).find((part) => ROUTING.test(part))?.trim();
  if (!routing) return clip(first, limit);
  // Keep the trigger phrase whole: it is what makes the skill discoverable.
  let out = `${first} ${routing}`;
  if (out.length > limit && first.length > 80) out = `${clip(first, 80)} ${routing}`;
  return clip(out, limit);
}

export interface CompactSkillsOptions {
  descriptionLimit?: number;
}

export interface CompactSkillsResult {
  /** The rewritten system prompt. */
  text: string;
  entries: number;
  before: number;
  after: number;
}

const OPEN = "<available_skills>";
const CLOSE = "</available_skills>";
const ENTRY = /  <skill>\s*<name>([\s\S]*?)<\/name>\s*<description>([\s\S]*?)<\/description>\s*<location>([\s\S]*?)<\/location>\s*<\/skill>/g;

/**
 * Rewrites the `<available_skills>` block of a system prompt. Returns undefined
 * when there is no block or nothing in it, so the caller leaves the prompt alone.
 */
export function compactSkillsBlock(prompt: string, options: CompactSkillsOptions = {}): CompactSkillsResult | undefined {
  const start = prompt.indexOf(OPEN);
  const end = prompt.indexOf(CLOSE, start + OPEN.length);
  if (start < 0 || end < 0) return undefined;
  const inner = prompt.slice(start + OPEN.length, end);
  const limit = options.descriptionLimit ?? DEFAULT_DESCRIPTION_LIMIT;
  const entries = [...inner.matchAll(ENTRY)];
  if (!entries.length) return undefined;
  const lines = entries.map((match) => {
    const [, name, description, location] = match;
    const text = shortenDescription((description ?? "").trim(), limit);
    return `<skill name="${(name ?? "").trim()}" location="${(location ?? "").trim()}">${text}</skill>`;
  });
  const rebuilt = `${prompt.slice(0, start + OPEN.length)}\n${lines.join("\n")}\n${CLOSE}${prompt.slice(end + CLOSE.length)}`;
  return { text: rebuilt, entries: lines.length, before: prompt.length, after: rebuilt.length };
}

/** Percentage of the prompt saved by the last compaction, for the command. */
export function savedPercent(result: CompactSkillsResult): number {
  return result.before > 0 ? Math.round((1 - result.after / result.before) * 100) : 0;
}

export default function skillsCompact(pi: ExtensionAPI) {
  if (["0", "false", "off", "no"].includes((process.env.PI_SKILLS_COMPACT ?? "").toLowerCase())) return;
  const configured = Number(process.env.PI_SKILLS_COMPACT_LIMIT ?? DEFAULT_DESCRIPTION_LIMIT);
  const descriptionLimit = Number.isFinite(configured) && configured >= 80 ? Math.floor(configured) : DEFAULT_DESCRIPTION_LIMIT;

  pi.on("before_agent_start", (event) => {
    try {
      const result = compactSkillsBlock(event.systemPrompt, { descriptionLimit });
      return result ? { systemPrompt: result.text } : undefined;
    } catch { return undefined; }
  });

  pi.registerCommand("skills-compact", {
    description: "Report how much the compacted skill list saves",
    handler: async (_args, ctx) => {
      const result = compactSkillsBlock(ctx.getSystemPrompt(), { descriptionLimit });
      if (!result) { ctx.ui.notify("No skill block in the current system prompt.", "info"); return; }
      ctx.ui.notify(
        `skills: ${result.entries} entries, ${result.before} → ${result.after} chars (saved ${savedPercent(result)}%, cap ${descriptionLimit} chars)`,
        "info",
      );
    },
  });
}
