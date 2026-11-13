import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findServerMemories, memoryServerAuth, parseMcpBody } from "../../extensions/memory/server.ts";

function agentDir(auth?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-memory-server-"));
  if (auth !== undefined) writeFileSync(join(dir, "mcp-auth.json"), JSON.stringify(auth));
  return dir;
}

const AUTH_KEY = "mcp__memory_server|https://memories.example/mcp";

test("the memory-server token is read from mcp-auth.json and expired tokens are refused", () => {
  const dir = agentDir({ [AUTH_KEY]: { serverUrl: "https://memories.example/mcp", tokens: { access_token: "tok" }, tokensExpireAt: 2_000 } });
  try {
    expect(memoryServerAuth(dir, 1_000)).toEqual({ url: "https://memories.example/mcp", token: "tok" });
    // No refresh here: an expired token means the human reconnects it with /mcp.
    expect(memoryServerAuth(dir, 3_000)).toBeUndefined();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an unrelated or incomplete auth entry yields no server", () => {
  const unrelated = agentDir({ "mcp__pustak|https://pustak.example/mcp": { serverUrl: "https://pustak.example/mcp", tokens: { access_token: "t" } } });
  const incomplete = agentDir({ [AUTH_KEY]: { serverUrl: "https://memories.example/mcp", tokens: {} } });
  const missing = agentDir();
  try {
    expect(memoryServerAuth(unrelated)).toBeUndefined();
    expect(memoryServerAuth(incomplete)).toBeUndefined();
    expect(memoryServerAuth(missing)).toBeUndefined();
  } finally {
    for (const dir of [unrelated, incomplete, missing]) rmSync(dir, { recursive: true, force: true });
  }
});

test("an MCP answer is read from both server-sent events and plain JSON", () => {
  expect(parseMcpBody('event: message\ndata: {"result":{"content":[]}}\n')).toEqual({ result: { content: [] } });
  expect(parseMcpBody('{"result":{"content":[]}}')).toEqual({ result: { content: [] } });
  expect(parseMcpBody("event: ping\n\n")).toBeUndefined();
  expect(parseMcpBody("{not json")).toBeUndefined();
});

test("find_memories maps the structured rows and sends the query as a tools/call", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const body = "data: " + JSON.stringify({
    result: {
      content: [{ type: "text", text: "Found 1 result" }],
      structuredContent: {
        success: true,
        data: {
          memories: [{
            id: "m1",
            name: "Fabric next ideas",
            content: "# Next ideas\n\nRun two agents.",
            tags: ["fabric", "ideas"],
            updated_at: "2026-11-04T19:13:00.000Z",
          }],
        },
      },
    },
  }) + "\n";
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;

  const memories = await findServerMemories("fabric", { auth: { url: "https://memories.example/mcp", token: "tok" }, fetchImpl });
  expect(memories).toEqual([{
    id: "m1",
    name: "Fabric next ideas",
    content: "# Next ideas\n\nRun two agents.",
    tags: ["fabric", "ideas"],
    updatedAt: "2026-11-04T19:13:00.000Z",
  }]);
  expect(seen[0]!.url).toBe("https://memories.example/mcp");
  const headers = seen[0]!.init.headers as Record<string, string>;
  expect(headers.Authorization).toBe("Bearer tok");
  // Cloudflare answers 403 to the default fetch agent, so the search names itself.
  expect(headers["User-Agent"]).toBe("pi-memory-search/1");
  const sent = JSON.parse(String(seen[0]!.init.body));
  expect(sent.method).toBe("tools/call");
  expect(sent.params).toEqual({ name: "find_memories", arguments: { query: "fabric" } });
});

test("a server without structured content still returns its summary text", async () => {
  const fetchImpl = (async () => new Response('{"result":{"content":[{"type":"text","text":"Nothing found for \\"xyz\\"."}]}}')) as unknown as typeof fetch;
  const memories = await findServerMemories("xyz", { auth: { url: "https://memories.example/mcp", token: "tok" }, fetchImpl });
  expect(memories).toEqual([{ name: "memory-server", content: 'Nothing found for "xyz".', tags: [] }]);
});

test("a failed or rejected search throws a message the caller can show", async () => {
  const unauthorized = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
  await expect(findServerMemories("q", { auth: { url: "https://x/mcp", token: "tok" }, fetchImpl: unauthorized }))
    .rejects.toThrow("401 — reconnect it with /mcp");

  const rejected = (async () => new Response('data: {"error":{"message":"bad query"}}\n')) as unknown as typeof fetch;
  await expect(findServerMemories("q", { auth: { url: "https://x/mcp", token: "tok" }, fetchImpl: rejected }))
    .rejects.toThrow("bad query");
});
