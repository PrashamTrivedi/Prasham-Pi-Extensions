import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { join } from "node:path";

export type ActivityItem = { at: string; kind: "activity" | "finding" | "tool" | "error"; text: string };
export type ActivitySnapshot = { updatedAt: string; items: ActivityItem[] };
// Never render terminal control sequences from tool/model output.
export function clean(value: string, limit = 4000): string {
  return value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").slice(0, limit);
}
export function readPreview(path?: string, limit = 24000): string {
  if (!path || !existsSync(path)) return "";
  let fd: number | undefined;
  try {
    fd = openSync(path, "r"); const size = statSync(path).size;
    const buffer = Buffer.alloc(Math.min(size, limit));
    const count = readSync(fd, buffer, 0, buffer.length, 0);
    return clean(buffer.subarray(0, count).toString("utf8"), limit) + (size > limit ? "\n… preview truncated; inspect the saved file for full output." : "");
  } catch { return ""; } finally { if (fd !== undefined) closeSync(fd); }
}
export function readActivity(dir: string, id: string): ActivitySnapshot {
  try { return JSON.parse(readFileSync(join(dir, "activity", `${id}.json`), "utf8")); }
  catch { return { updatedAt: "", items: [] }; }
}
export function publishActivity(dir: string, id: string, kind: ActivityItem["kind"], text: string): void {
  try {
    const folder = join(dir, "activity"); mkdirSync(folder, { recursive: true });
    const file = join(folder, `${id}.json`); const previous = readActivity(dir, id);
    const at = new Date().toISOString();
    const next: ActivitySnapshot = { updatedAt: at, items: [...previous.items, { at, kind, text: clean(text) }].slice(-60) };
    // Each child owns its snapshot; readers see either the old or new complete JSON.
    const temp = `${file}.${process.pid}.tmp`; writeFileSync(temp, JSON.stringify(next)); renameSync(temp, file);
  } catch { /* Observability must not fail the agent's task. */ }
}
