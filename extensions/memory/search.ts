/**
 * Local memory search: the index plus every memory file beside it.
 *
 * Matching is deliberately a plain case-insensitive substring. A memory is a few
 * dozen words, so a fuzzy rank would add noise instead of signal; a hit in the
 * name or description simply outranks a hit in the body.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface MemoryHit {
  /** File name inside the memory directory, for example `project_x.md`. */
  file: string;
  title: string;
  description: string;
  /** The first matching body line, trimmed, when the match is in the body. */
  line?: string;
  /** Match quality: 0 name, 1 description, 2 body. Lower is better. */
  score: number;
}

/** Frontmatter fields are the only structure a memory file guarantees. */
function frontmatter(text: string): Record<string, string> {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end < 0) return {};
  const fields: Record<string, string> = {};
  for (const line of text.slice(3, end).split("\n")) {
    const match = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (match?.[1] && match[2] !== undefined) fields[match[1]] = match[2].trim();
  }
  return fields;
}

/** `- [file](file) — description` lines, so a file without frontmatter still has a title. */
export function readIndex(dir: string, indexFile = "MEMORY.md"): Map<string, string> {
  const descriptions = new Map<string, string>();
  let text = "";
  try {
    text = readFileSync(join(dir, indexFile), "utf8");
  } catch {
    return descriptions;
  }
  for (const line of text.split("\n")) {
    const match = line.match(/^-\s*\[([^\]]+)\]\([^)]*\)\s*[—-]\s*(.+)$/);
    if (match?.[1] && match[2]) descriptions.set(match[1].trim(), match[2].trim());
  }
  return descriptions;
}

/** A short, single-line excerpt around the match, for the result list. */
function excerpt(line: string, needle: string): string {
  const text = line.replace(/\s+/g, " ").trim();
  const at = text.toLowerCase().indexOf(needle);
  const start = Math.max(0, at - 40);
  const cut = text.slice(start, start + 160);
  return `${start > 0 ? "…" : ""}${cut}${start + 160 < text.length ? "…" : ""}`;
}

/**
 * Every memory file whose name, description, or body contains `query`.
 * Results are ordered name-hit, description-hit, body-hit, then by file name.
 */
export function searchLocal(dir: string, query: string, options: { indexFile?: string } = {}): MemoryHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const index = readIndex(dir, options.indexFile);
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".md") && name !== (options.indexFile ?? "MEMORY.md")).sort();
  } catch {
    return [];
  }
  const hits: MemoryHit[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(join(dir, file), "utf8");
    } catch {
      continue;
    }
    const fields = frontmatter(text);
    const title = fields.name ?? file.replace(/\.md$/, "");
    const description = fields.description ?? index.get(file) ?? "";
    let score = -1;
    let line: string | undefined;
    if (title.toLowerCase().includes(needle)) score = 0;
    else if (description.toLowerCase().includes(needle)) score = 1;
    else {
      for (const bodyLine of text.split("\n")) {
        if (bodyLine.toLowerCase().includes(needle)) {
          score = 2;
          line = excerpt(bodyLine, needle);
          break;
        }
      }
    }
    if (score < 0) continue;
    hits.push({ file, title, description, ...(line ? { line } : {}), score });
  }
  return hits.sort((left, right) => left.score - right.score || left.file.localeCompare(right.file));
}
