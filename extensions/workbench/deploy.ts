/**
 * deploy — remember the commit each Worker deploy shipped and publish it as a HUD card
 * `deploy-<name>` (ttl 1h). Triggered by a successful bash result containing a wrangler deploy or
 * versions-upload; later `git commit/merge/pull/...` steps refresh the "N commits not deployed" drift.
 * Records live in session state (`pi.appendEntry`), so they survive resume and stay out of model context.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { latestByType, stateFromBranch } from "../shared/state.ts";
import { flattenContent } from "../shared/tool-call.ts";
import type { WorkbenchConfig } from "./config.ts";
import {
  actionsOf,
  ancestors,
  buildCard,
  DEPLOY_STATE_TYPE,
  deploySucceeded,
  recordsOf,
  WRANGLER_FILES,
  workerFromOutput,
  type DeployCard,
  type DeployRecords,
} from "./deploy-logic.ts";
import { resolveHudDir } from "./hud.ts";

const GIT_TIMEOUT_MS = 5000;

function wranglerRoot(dir: string): string | null {
  for (const candidate of ancestors(dir)) {
    for (const file of WRANGLER_FILES) if (existsSync(join(candidate, file))) return candidate;
  }
  return null;
}

const recordedRoot = (records: DeployRecords, dir: string): string | null =>
  ancestors(dir).find((candidate) => records[candidate] !== undefined) ?? null;

function gitOut(root: string, argv: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", argv, { cwd: root, timeout: GIT_TIMEOUT_MS }, (error, stdout) => {
      resolve(error ? null : String(stdout).trim());
    });
  });
}

/** Atomic write (temp file + rename) into the shared drop dir. */
export function publishCard(card: DeployCard, dir: string = resolveHudDir()): void {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${card.source}.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(card, null, 2));
  renameSync(tmp, join(dir, `${card.source}.json`));
}

export function registerDeploy(pi: ExtensionAPI, getConfig: () => WorkbenchConfig): void {
  let records: DeployRecords = {};
  let queue: Promise<unknown> = Promise.resolve();

  pi.on("session_start", async (_event, ctx) => {
    try {
      records = recordsOf(latestByType(stateFromBranch(ctx.sessionManager.getBranch()), DEPLOY_STATE_TYPE));
    } catch {
      records = {};
    }
  });

  const handle = async (command: string, output: string, cwd: string): Promise<void> => {
    const actions = actionsOf(command, cwd, homedir());
    const ship = actions.find((action) => action.kind === "deploy" || action.kind === "upload");
    const move = actions.find((action) => action.kind === "move");

    if (ship !== undefined) {
      if (!deploySucceeded(output)) return;
      const root = wranglerRoot(ship.dir);
      if (root === null) return;
      const sha = await gitOut(root, ["rev-parse", "HEAD"]);
      if (!sha) return;
      const record = {
        deployedAt: Date.now(),
        sha,
        worker: workerFromOutput(output) ?? "",
        kind: ship.kind === "upload" ? ("upload" as const) : ("deploy" as const),
      };
      records = { ...records, [root]: record };
      pi.appendEntry(DEPLOY_STATE_TYPE, records);
      publishCard(buildCard(root, record, sha, 0, record.deployedAt));
    } else if (move !== undefined) {
      const root = recordedRoot(records, move.dir);
      const record = root === null ? undefined : records[root];
      if (root === null || record === undefined) return;
      const head = await gitOut(root, ["rev-parse", "HEAD"]);
      if (!head) return;
      const count = head === record.sha ? "0" : await gitOut(root, ["rev-list", "--count", `${record.sha}..HEAD`]);
      const ahead = count === null || count === "" || Number.isNaN(Number(count)) ? null : Number(count);
      publishCard(buildCard(root, record, head, ahead, Date.now()));
    }
  };

  pi.on("tool_result", async (event, ctx) => {
    if (!getConfig().deploy.enabled || event.toolName !== "bash" || event.isError) return undefined;
    const command = typeof event.input?.command === "string" ? event.input.command : "";
    if (command.length === 0) return undefined;
    const output = flattenContent(event.content as Array<{ type?: string; text?: string }>);
    // Serialized so two quick bash results never interleave their read-modify-write of `records`.
    queue = queue
      .catch(() => undefined)
      .then(() => handle(command, output, ctx.cwd))
      .catch(() => undefined); // The call's result matters more than the card.
    await queue;
    return undefined;
  });
}
