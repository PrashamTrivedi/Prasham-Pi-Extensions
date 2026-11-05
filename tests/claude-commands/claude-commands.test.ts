import { test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import claudeCommands, {
 discoverCommands,
 expandBody,
 parseCommandFile,
 splitArgs,
} from '../../extensions/claude-commands/index.ts';

test('parses frontmatter and body', () => {
 const { meta, body } = parseCommandFile('---\ndescription: Do it\nargument-hint: [x]\nallowed-tools: Bash\n---\n# Hi\nbody');
 expect(meta.description).toBe('Do it');
 expect(meta['argument-hint']).toBe('[x]');
 expect(body).toBe('# Hi\nbody');
 expect(parseCommandFile('no front').body).toBe('no front');
});

test('splits quoted args', () => {
 expect(splitArgs('a "b c" \'d e\' f')).toEqual(['a', 'b c', 'd e', 'f']);
});

test('substitutes $ARGUMENTS and positionals', () => {
 expect(expandBody('all: $ARGUMENTS; one: $1; two: $2; nine: $9.', 'x "y z"')).toBe('all: x "y z"; one: x; two: y z; nine: .');
});

test('appends ARGUMENTS when body has no placeholder', () => {
 expect(expandBody('Do the thing', 'foo')).toBe('Do the thing\n\nARGUMENTS: foo');
 expect(expandBody('Do the thing', '')).toBe('Do the thing');
});

test('never executes bash injection, adds a note', () => {
 const out = expandBody('Status: !`git status`', '');
 expect(out).toContain('!`git status`');
 expect(out).toContain('not executed');
});

test('namespaces subfolders and survives symlink loops', () => {
 const root = mkdtempSync(join(tmpdir(), 'cc-'));
 mkdirSync(join(root, 'git'));
 writeFileSync(join(root, 'top.md'), '---\ndescription: Top\n---\nbody');
 writeFileSync(join(root, 'git', 'blame.md'), '# Blame things\nx');
 symlinkSync(root, join(root, 'commands'));
 const { commands } = discoverCommands(root);
 expect(commands.map((c) => c.name).sort()).toEqual(['git:blame', 'top']);
 expect(commands.find((c) => c.name === 'git:blame')!.description).toBe('Blame things');
});

test('registers commands, skips built-ins, sends expanded message', async () => {
 const root = mkdtempSync(join(tmpdir(), 'cc-'));
 writeFileSync(join(root, 'hello.md'), 'Hi $1');
 writeFileSync(join(root, 'tree.md'), 'clash');
 process.env.PI_CLAUDE_COMMANDS_DIR = root;
 const registered = new Map<string, any>();
 const hooks = new Map<string, Function>();
 const sent: string[] = [];
 claudeCommands({
  registerCommand: (n: string, o: any) => registered.set(n, o),
  on: (n: string, h: Function) => hooks.set(n, h),
  getCommands: () => [],
  sendUserMessage: (m: string) => sent.push(m),
 } as any);
 expect([...registered.keys()]).toEqual(['hello']);
 const notes: string[] = [];
 await hooks.get('session_start')!({}, { cwd: root, ui: { notify: (m: string) => notes.push(m) } });
 expect(notes.join()).toContain('tree (name in use)');
 await registered.get('hello').handler('bob', { ui: { notify() {} } });
 expect(sent).toEqual(['Hi bob']);
 delete process.env.PI_CLAUDE_COMMANDS_DIR;
});
