/**
 * Structured question parsing for `/duck`.
 *
 * The duck model is asked for JSON only, but the model is not trusted to obey:
 * anything malformed is clamped or dropped here, and the caller falls back to
 * rendering the raw text. Parsing happens once, on the completed answer — never on
 * a streaming delta, where the JSON is still incomplete.
 */

/** Claude Code parity: at most four questions, at most four options each. */
export const DUCK_MAX_QUESTIONS = 4;
export const DUCK_MAX_OPTIONS = 4;
export const DUCK_HEADER_MAX = 12;

export interface DuckOption {
  label: string;
  description?: string;
}

export interface DuckQuestion {
  id: string;
  header: string;
  question: string;
  options: DuckOption[];
  allowOther: boolean;
}

export interface DuckParse {
  questions: DuckQuestion[];
  /** True when at least one usable question was recovered. */
  ok: boolean;
}

const EMPTY: DuckParse = { questions: [], ok: false };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The balanced `[...]` slice starting at `start`, ignoring brackets inside strings. */
function balancedFrom(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}

/** Strip a leading/trailing markdown code fence, if present. */
function unfold(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/);
  return (fence?.[1] ?? trimmed).trim();
}

function toOptions(value: unknown): DuckOption[] {
  if (!Array.isArray(value)) return [];
  const options: DuckOption[] = [];
  for (const raw of value) {
    if (!isObject(raw)) continue;
    const label = clean(raw.label);
    if (!label) continue;
    const description = clean(raw.description);
    options.push(description ? { label, description } : { label });
    if (options.length === DUCK_MAX_OPTIONS) break;
  }
  return options;
}

function toQuestion(value: unknown, index: number): DuckQuestion | undefined {
  if (!isObject(value)) return undefined;
  const question = clean(value.question) || clean(value.prompt);
  if (!question) return undefined;
  const header = clean(value.header) || `Q${index + 1}`;
  return {
    id: `q${index + 1}`,
    header: header.slice(0, DUCK_HEADER_MAX),
    question,
    options: toOptions(value.options),
    allowOther: value.allowOther !== false,
  };
}

function collect(parsed: unknown[]): DuckQuestion[] {
  const questions: DuckQuestion[] = [];
  for (const item of parsed) {
    const question = toQuestion(item, questions.length);
    if (question) questions.push(question);
    if (questions.length === DUCK_MAX_QUESTIONS) break;
  }
  return questions;
}

/**
 * Recover structured questions from a completed model answer. Accepts a bare array,
 * a fenced array, or an array wrapped in prose. Each `[` in turn is tried, so prose
 * or markdown that happens to contain brackets does not defeat the scan. Returns
 * `{ questions: [], ok: false }` when nothing usable is present, so the caller can
 * fall back to the raw text.
 */
export function parseDuckQuestions(text: string): DuckParse {
  const body = unfold(text);
  for (let start = body.indexOf("["); start !== -1; start = body.indexOf("[", start + 1)) {
    const slice = balancedFrom(body, start);
    if (!slice) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(slice);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const questions = collect(parsed);
    if (questions.length > 0) return { questions, ok: true };
  }
  return EMPTY;
}
