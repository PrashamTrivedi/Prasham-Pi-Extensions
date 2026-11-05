/**
 * Deploy tracker logic — pure. Mirrors the Claude Code mod's `hooks/lib/deploy-logic.ts`: which Bash
 * commands deploy a Worker or move HEAD, where they ran, and the HUD card that says how far HEAD is
 * past the deployed commit. Pi adds output parsing: the worker name and the success check come from
 * wrangler's own output, because Pi hands the hook the result text.
 */

export const WRANGLER_FILES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"] as const;
export const DEPLOY_TTL_SEC = 3600;
export const DEPLOY_STATE_TYPE = "workbench-deploys";

export type DeployKind = "deploy" | "upload";

/** The last deploy per wrangler root, kept in the extension's session state. */
export interface DeployRecord {
  deployedAt: number;
  sha: string;
  worker: string;
  kind: DeployKind;
}
export type DeployRecords = Record<string, DeployRecord>;

export interface CommandAction {
  kind: "deploy" | "upload" | "move";
  /** The absolute directory the command ran in, after any `cd X &&` before it. */
  dir: string;
}

export interface DeployCard {
  source: string;
  title: string;
  status: "ok" | "warn";
  progress: null;
  lines: string[];
  updatedAt: number;
  ttlSec: number;
}

const WRANGLER =
  /^(?:(?:npx|bunx|pnpm\s+dlx|pnpm\s+exec|yarn\s+dlx|bun\s+x)\s+(?:-\S+\s+)*)?wrangler(?:@\S+)?\s+/;
const DEPLOY = new RegExp(`${WRANGLER.source}(?:deploy|versions\\s+deploy)(?:\\s|$)`);
const UPLOAD = new RegExp(`${WRANGLER.source}versions\\s+upload(?:\\s|$)`);
const SCRIPT = /^(?:npm|bun|pnpm|yarn)\s+run\s+deploy(?::\S+)?(?:\s|$)/;
const MOVE = /^git(?:\s+-C\s+(\S+))?\s+(?:commit|merge|pull|rebase|cherry-pick)(?:\s|$)/;
const NOT_A_RUN = /(?:^|\s)(?:--dry-run|--abort|--quit|--help|-h)(?:\s|$)/;

/** Collapses `.` and `..` and doubled slashes of an absolute path. */
export function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

const unquote = (word: string): string => word.replace(/^(['"])(.*)\1$/, "$2");

/** `cd X` and `git -C X` targets to an absolute directory, or null when it cannot be told. */
export function resolveDir(base: string, target: string, home?: string): string | null {
  const word = unquote(target.trim());
  if (word === "" || word === "-" || word.includes("$") || word.includes("`")) return null;
  if (word === "~" || word.startsWith("~/")) return home ? normalize(`${home}${word.slice(1)}`) : null;
  return normalize(word.startsWith("/") ? word : `${base}/${word}`);
}

const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/;

/** The command's segments in order, env assignments stripped. Quotes are not honoured; a miss is the only cost. */
export const segmentsOf = (command: string): string[] =>
  command
    .split(/&&|\|\||;|\||\n/)
    .map((part) => {
      let segment = part.trim();
      while (ENV_ASSIGN.test(segment)) segment = segment.replace(ENV_ASSIGN, "");
      return segment;
    })
    .filter((segment) => segment.length > 0);

export const isUploadSegment = (segment: string): boolean => UPLOAD.test(segment) && !NOT_A_RUN.test(segment);
export const isDeploySegment = (segment: string): boolean =>
  (DEPLOY.test(segment) || SCRIPT.test(segment)) && !NOT_A_RUN.test(segment);

export const isDeployCommand = (command: string): boolean =>
  segmentsOf(command).some((segment) => isDeploySegment(segment) || isUploadSegment(segment));

/** Every deploy and HEAD-moving git step of a command with the directory it ran in, in order. */
export function actionsOf(command: string, cwd: string, home?: string): CommandAction[] {
  const actions: CommandAction[] = [];
  let dir = normalize(cwd);
  for (const segment of segmentsOf(command)) {
    const change = /^cd\s+("[^"]*"|'[^']*'|\S+)\s*$/.exec(segment);
    if (change?.[1] !== undefined) {
      dir = resolveDir(dir, change[1], home) ?? dir;
      continue;
    }
    if (isDeploySegment(segment)) {
      actions.push({ kind: "deploy", dir });
      continue;
    }
    if (isUploadSegment(segment)) {
      actions.push({ kind: "upload", dir });
      continue;
    }
    const move = MOVE.exec(segment);
    if (move !== null && !NOT_A_RUN.test(segment)) {
      actions.push({ kind: "move", dir: move[1] === undefined ? dir : (resolveDir(dir, move[1], home) ?? dir) });
    }
  }
  return actions;
}

/** wrangler printed a success line for a deploy or a version upload. */
export function deploySucceeded(output: string): boolean {
  return /(?:^|\n)\s*(?:Deployed\s+\S+|Uploaded\s+\S+|Current Version ID:|Worker Version ID:|Version ID:)/.test(output);
}

/** The worker name from `Uploaded <name> (…)` / `Deployed <name> triggers`, if wrangler printed one. */
export function workerFromOutput(output: string): string | undefined {
  const match = /(?:^|\n)\s*(?:Uploaded|Deployed)\s+([A-Za-z0-9][A-Za-z0-9._-]*)\b/.exec(output);
  return match?.[1];
}

/** `/a/b/c` to `['/a/b/c', '/a/b', '/a', '/']`: where to look for a project root, nearest first. */
export function ancestors(dir: string): string[] {
  const out: string[] = [];
  let current = normalize(dir);
  for (;;) {
    out.push(current);
    if (current === "/") return out;
    current = normalize(`${current}/..`);
  }
}

export const projectName = (root: string): string => root.split("/").filter(Boolean).pop() ?? "root";

/** HUD source of a worker: `deploy-<name>`, limited to the characters the `hud` CLI accepts. */
export const sourceOf = (name: string): string =>
  `deploy-${name.replace(/[^A-Za-z0-9._-]/g, "-")}`.replace(/^deploy-\./, "deploy-_").slice(0, 64);

export const shortSha = (sha: string): string => sha.slice(0, 7);

const pad = (n: number): string => String(n).padStart(2, "0");

/** `10-05 12:11` in the machine's local time. */
export function localStamp(ms: number): string {
  const when = new Date(ms);
  return `${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/**
 * The card for one wrangler root. `ahead` is `git rev-list --count <deployed>..HEAD`, or null when git
 * could not tell (the deployed commit is gone after a rebase or a shallow clone).
 */
export function buildCard(
  root: string,
  record: DeployRecord,
  head: string,
  ahead: number | null,
  now: number,
): DeployCard {
  const name = record.worker || projectName(root);
  const verb = record.kind === "upload" ? "uploaded" : "deployed";
  const isSame = head === record.sha;
  const lines = [`${verb} ${shortSha(record.sha)} ${localStamp(record.deployedAt)}`, `HEAD ${shortSha(head)}`];
  const base = { source: sourceOf(name), progress: null, lines, updatedAt: now, ttlSec: DEPLOY_TTL_SEC } as const;

  if (isSame || ahead === 0) {
    return { ...base, title: `${name}: ${isSame ? verb : "nothing new to deploy"}`, status: "ok" };
  }
  if (ahead === null) return { ...base, title: `${name}: HEAD differs from ${verb} commit`, status: "warn" };
  return { ...base, title: `${name}: ${ahead} commit${ahead === 1 ? "" : "s"} not deployed`, status: "warn" };
}

/** A state value to records, dropping anything malformed. */
export function recordsOf(value: unknown): DeployRecords {
  const out: DeployRecords = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  for (const [root, record] of Object.entries(value as Record<string, unknown>)) {
    const fields = record as Partial<DeployRecord> | null;
    if (typeof fields?.sha === "string" && typeof fields.deployedAt === "number") {
      out[root] = {
        deployedAt: fields.deployedAt,
        sha: fields.sha,
        worker: typeof fields.worker === "string" ? fields.worker : "",
        kind: fields.kind === "upload" ? "upload" : "deploy",
      };
    }
  }
  return out;
}
