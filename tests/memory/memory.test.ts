import { test, expect } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import memory, {
 INDEX_FILE,
 escapedProject,
 memoryDirFor,
 memoryRoot,
 ensureMemory,
 protocolBlock,
} from '../../extensions/memory/index.ts';

function harness(extension: Function, cwd: string) {
 const hooks = new Map<string, Function>();
 extension({ on: (name: string, handler: Function) => hooks.set(name, handler) });
 return { hooks, ctx: { cwd } };
}

function withRoot<T>(root: string, run: () => T): T {
 const previous = process.env.PI_MEMORY_ROOT;
 process.env.PI_MEMORY_ROOT = root;
 try {
  return run();
 } finally {
  if (previous === undefined) delete process.env.PI_MEMORY_ROOT;
  else process.env.PI_MEMORY_ROOT = previous;
 }
}

test('memory directory mirrors Claude escaping and honours the root override', () => {
 expect(escapedProject('/root/Code/Projects/Prasham-Pi-Extensions')).toBe('-root-Code-Projects-Prasham-Pi-Extensions');
 expect(escapedProject('/root/Code/a b/c_d')).toBe('-root-Code-a-b-c-d');
 expect(memoryRoot({ root: '/tmp/mem' })).toBe('/tmp/mem');
 expect(memoryRoot({ agentDir: '/tmp/agent' })).toBe('/tmp/agent/projects');
 expect(memoryDirFor('/root/Code/x', { root: '/tmp/mem' })).toBe('/tmp/mem/-root-Code-x/memory');
 expect(memoryDirFor('/root/Code/x', { agentDir: '/tmp/agent' })).toBe('/tmp/agent/projects/-root-Code-x/memory');
});

test('ensureMemory creates the index once and never overwrites it', () => {
 const dir = mkdtempSync(join(tmpdir(), 'pi-memory-'));
 const memoryDir = join(dir, 'project');
 try {
  expect(ensureMemory(memoryDir).indexCreated).toBe(true);
  const file = join(memoryDir, INDEX_FILE);
  expect(readFileSync(file, 'utf8')).toBe('# Memory Index\n');

  writeFileSync(file, '# Memory Index\n\n- [next_release.md](next_release.md) \u2014 cut the release\n');
  expect(ensureMemory(memoryDir).indexCreated).toBe(false);
  expect(readFileSync(file, 'utf8')).toContain('next_release.md');
 } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('protocol names the location, the file shape, and the read/write triggers', () => {
 const block = protocolBlock('/tmp/mem/-root-Code-x');
 expect(block).toContain('/tmp/mem/-root-Code-x');
 expect(block).toContain(INDEX_FILE);
 expect(block).toContain('next_*');
 expect(block).toContain('project_*');
 expect(block).toContain('feedback_*');
 expect(block).toContain('reference_*');
 expect(block).toContain('Read `MEMORY.md` before planning');
 expect(block).toContain('Never write secrets');
});

test('session start creates the directory and every run injects the protocol', async () => {
 const root = mkdtempSync(join(tmpdir(), 'pi-memory-root-'));
 const cwd = '/root/Code/Projects/memory-fixture';
 try {
  const dir = withRoot(root, () => {
   const { hooks, ctx } = harness(memory, cwd);
   hooks.get('session_start')!({}, ctx);
   return memoryDirFor(cwd);
  });
  expect(existsSync(join(dir, INDEX_FILE))).toBe(true);

  const injected = withRoot(root, async () => {
   const { hooks, ctx } = harness(memory, cwd);
   hooks.get('session_start')!({}, ctx);
   return hooks.get('before_agent_start')!({ systemPrompt: 'Base' }, ctx);
  });
  const prompt = (await injected).systemPrompt;
  expect(prompt).toContain('Base');
  expect(prompt).toContain('## Project memory');
  expect(prompt).toContain(dir);
 } finally { rmSync(root, { recursive: true, force: true }); }
});
