/** The plan's `Original Ask` section (any heading level), up to the next same-or-higher heading. */
export function extractOutcome(plan: string): string {
  return extractSection(plan, /original ask/i);
}

/**
 * The body of the first heading matching `heading`, up to the next heading of the same or higher
 * level. Headings inside fenced code blocks are ignored: real tickets pasted into a plan keep
 * their own `#` headings, and those must not truncate the section.
 */
export function extractSection(markdown: string, heading: RegExp): string {
  const lines = (markdown ?? "").split(/\r?\n/);
  let start = -1;
  let level = 0;
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!match) continue;
    if (start === -1) {
      if (heading.test(match[2])) {
        start = index + 1;
        level = match[1].length;
      }
      continue;
    }
    if (match[1].length <= level) {
      return lines.slice(start, index).join("\n").trim();
    }
  }
  return start === -1 ? "" : lines.slice(start).join("\n").trim();
}
