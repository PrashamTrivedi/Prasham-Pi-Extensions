import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishCard } from "../../extensions/workbench/deploy.ts";
import {
  actionsOf,
  ancestors,
  buildCard,
  deploySucceeded,
  isDeployCommand,
  normalize,
  recordsOf,
  sourceOf,
  workerFromOutput,
} from "../../extensions/workbench/deploy-logic.ts";

describe("command detection", () => {
  test("wrangler deploy shapes", () => {
    for (const cmd of [
      "wrangler deploy",
      "npx wrangler deploy --env prod",
      "bunx wrangler@4 deploy",
      "pnpm dlx wrangler versions deploy",
      "npx wrangler versions upload",
      "npm run deploy",
      "NODE_ENV=x npm run deploy:prod",
      "cd api && npx wrangler deploy",
    ]) {
      expect(isDeployCommand(cmd)).toBe(true);
    }
  });

  test("non-runs", () => {
    for (const cmd of ["wrangler deploy --dry-run", "wrangler dev", "echo wrangler deploy", "npm run build", "wrangler deploy --help"]) {
      expect(isDeployCommand(cmd)).toBe(false);
    }
  });

  test("cd tracking and kinds", () => {
    const actions = actionsOf("cd api && npx wrangler versions upload; git -C ../web commit -m x", "/r/proj", "/home/u");
    expect(actions).toEqual([
      { kind: "upload", dir: "/r/proj/api" },
      { kind: "move", dir: "/r/proj/web" },
    ]);
    expect(actionsOf("cd ~/x && wrangler deploy", "/r", "/home/u")).toEqual([{ kind: "deploy", dir: "/home/u/x" }]);
    expect(actionsOf("cd $X && wrangler deploy", "/r")).toEqual([{ kind: "deploy", dir: "/r" }]);
  });
});

describe("output parsing", () => {
  const out = `Total Upload: 10 KiB\nUploaded my-api (3.1 sec)\nDeployed my-api triggers (1.2 sec)\n  https://my-api.x.workers.dev\nCurrent Version ID: abc`;
  test("success and worker name", () => {
    expect(deploySucceeded(out)).toBe(true);
    expect(workerFromOutput(out)).toBe("my-api");
    expect(deploySucceeded("✘ [ERROR] A request to the Cloudflare API failed")).toBe(false);
    expect(workerFromOutput("nothing")).toBeUndefined();
  });
  test("versions upload output", () => {
    expect(deploySucceeded("Worker Version ID: 1234\nUploaded api (2 sec)")).toBe(true);
  });
});

describe("paths and cards", () => {
  test("normalize and ancestors", () => {
    expect(normalize("/a/./b/../c//d")).toBe("/a/c/d");
    expect(ancestors("/a/b")).toEqual(["/a/b", "/a", "/"]);
  });

  test("sourceOf sanitizes", () => {
    expect(sourceOf("my api")).toBe("deploy-my-api");
    expect(sourceOf(".x")).toBe("deploy-_x");
  });

  const rec = { deployedAt: 1_800_000_000_000, sha: "a".repeat(40), worker: "my-api", kind: "deploy" as const };
  test("card states", () => {
    const same = buildCard("/r/api", rec, rec.sha, 0, 5);
    expect(same).toMatchObject({ status: "ok", title: "my-api: deployed", source: "deploy-my-api", ttlSec: 3600, updatedAt: 5 });
    expect(buildCard("/r/api", rec, "b".repeat(40), 3, 5)).toMatchObject({ status: "warn", title: "my-api: 3 commits not deployed" });
    expect(buildCard("/r/api", rec, "b".repeat(40), 1, 5).title).toBe("my-api: 1 commit not deployed");
    expect(buildCard("/r/api", rec, "b".repeat(40), null, 5).title).toContain("differs");
    expect(buildCard("/r/api", { ...rec, worker: "", kind: "upload" }, rec.sha, 0, 5).title).toBe("api: uploaded");
  });

  test("recordsOf drops junk and defaults", () => {
    const out = recordsOf({ "/a": { sha: "x", deployedAt: 1 }, "/b": { sha: 5 }, "/c": null });
    expect(out).toEqual({ "/a": { sha: "x", deployedAt: 1, worker: "", kind: "deploy" } });
    expect(recordsOf(null)).toEqual({});
  });

  test("publishCard writes a parseable file atomically", () => {
    const dir = mkdtempSync(join(tmpdir(), "dep-"));
    const card = buildCard("/r/api", rec, rec.sha, 0, 5);
    publishCard(card, dir);
    expect(JSON.parse(readFileSync(join(dir, "deploy-my-api.json"), "utf8")).status).toBe("ok");
  });
});
