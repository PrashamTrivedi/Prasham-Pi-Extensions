/**
 * Supervision helpers for `sandbox-dev`.
 *
 * There is deliberately no permission policy here. The decision server judges every tool call;
 * this package neither pre-approves nor blocks anything on its own. What remains is the small
 * amount of local state supervision needs: which writes count as "implementation" (arming the
 * anchored outcome) and which count as planning artifacts.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Maximum supervised continuation turns for an anchored outcome. */
export const BUDGET = 8;

/** Narrow, implementation-only commands that mark the start of real work. Deliberately small. */
const IMPLEMENTATION_BASH = [
  "git commit",
  "git push",
  "npm install",
  "npm i ",
  "bun install",
  "bun add",
  "pnpm install",
  "pnpm add",
  "yarn install",
  "yarn add",
];

const MUTATING_TOOLS = new Set(["write", "edit"]);

/** True for paths under `taskNotes/`. Planning artifacts are written before approval. */
export function isPlanningPath(rawPath: string, cwd: string): boolean {
  if (!rawPath) return false;
  const rel = relative(resolve(cwd), resolve(cwd, rawPath));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return false;
  return rel.split(sep)[0] === "taskNotes";
}

/**
 * True when a tool call actually starts implementation: a source write/edit, or an implementation
 * command. Planning writes under `taskNotes/` do not count. Used to arm outcome supervision once
 * work begins, since approval itself lives in the transcript.
 */
export function isImplementation(
  call: { toolName: string; input: Record<string, unknown> },
  cwd: string,
): boolean {
  if (MUTATING_TOOLS.has(call.toolName)) {
    const raw = typeof call.input.path === "string" ? call.input.path : "";
    return raw !== "" && !isPlanningPath(raw, cwd);
  }
  if (call.toolName === "bash" || call.toolName === "powershell") {
    const command = String(call.input.command ?? "").toLowerCase();
    return IMPLEMENTATION_BASH.some((pattern) => command.includes(pattern.toLowerCase()));
  }
  return false;
}
