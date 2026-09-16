import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import recursiveContext from '../extensions/recursive-context.ts';
import projectContext from '../extensions/project-context.ts';

function harness(extension: Function, cwd: string, trusted = true) {
 const hooks = new Map<string, Function>();
 extension({ on: (name: string, handler: Function) => hooks.set(name, handler) });
 return { hooks, ctx: { cwd, isProjectTrusted: () => trusted } };
}
test('project context reports cwd and bounded directory structure', async () => {
 const cwd = mkdtempSync(join(tmpdir(), 'pi-context-'));
 try {
  writeFileSync(join(cwd, 'hello.txt'), 'fixture');
  const { hooks, ctx } = harness(projectContext, cwd);
  await hooks.get('session_start')!({}, ctx);
  const result = await hooks.get('before_agent_start')!({ systemPrompt: 'Base' }, ctx);
  expect(result.systemPrompt).toContain(cwd); expect(result.systemPrompt).toContain('hello.txt');
 } finally { rmSync(cwd, { recursive: true, force: true }); }
});
test('recursive context skips untrusted projects, root instructions, and symlinks outside cwd', async () => {
 const cwd = mkdtempSync(join(tmpdir(), 'pi-recursive-'));
 const outside = mkdtempSync(join(tmpdir(), 'pi-external-'));
 try {
  execFileSync('git', ['init', '-q'], { cwd });
  mkdirSync(join(cwd, 'nested')); mkdirSync(join(cwd, 'linked'));
  writeFileSync(join(cwd, 'AGENTS.md'), 'root must not duplicate');
  writeFileSync(join(cwd, 'nested', 'AGENTS.md'), 'nested instruction');
  writeFileSync(join(outside, 'AGENTS.md'), 'external secret fixture');
  symlinkSync(join(outside, 'AGENTS.md'), join(cwd, 'linked', 'AGENTS.md'));
  const blocked = harness(recursiveContext, cwd, false);
  expect(await blocked.hooks.get('before_agent_start')!({ systemPrompt: 'Base' }, blocked.ctx)).toBeUndefined();
  const { hooks, ctx } = harness(recursiveContext, cwd);
  const result = await hooks.get('before_agent_start')!({ systemPrompt: 'Base' }, ctx);
  expect(result.systemPrompt).toContain('nested instruction');
  expect(result.systemPrompt).not.toContain('root must not duplicate');
  expect(result.systemPrompt).not.toContain('external secret fixture');
 } finally { rmSync(cwd, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});
test('sanitizer is preview-only unless explicitly applied and skips symlinked directories', () => {
 const home = mkdtempSync(join(tmpdir(), 'pi-skills-'));
 try {
  const dir = join(home, '.agents', 'skills', 'example'); mkdirSync(dir, { recursive: true });
  const file = join(dir, 'SKILL.md'); const original = '---\nname: example::skill\ndescription: fixture\n---\nFixture\n';
  writeFileSync(file, original);
  symlinkSync(join(home, '.agents', 'skills'), join(home, '.agents', 'skills', 'loop'));
  const script = fileURLToPath(new URL('../extensions/sanitize-skill-names.ts', import.meta.url));
  const env = { ...process.env, HOME: home };
  const preview = execFileSync(process.execPath, [script], { env, encoding: 'utf8' });
  expect(preview).toContain('would patch'); expect(readFileSync(file, 'utf8')).toBe(original);
  execFileSync(process.execPath, [script, '--apply'], { env });
  expect(readFileSync(file, 'utf8')).toContain('name: example-skill');
 } finally { rmSync(home, { recursive: true, force: true }); }
});
