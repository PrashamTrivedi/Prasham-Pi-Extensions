import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Local-first rule: every extension developed here must be enabled in this
// directory. `.pi/settings.json` loads this package, so "enabled here" means the
// entry is listed in `pi.extensions`.
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const listed = new Set(pkg.pi.extensions.map((entry) => resolve(root, entry)));

// 1. A source file with a default export under extensions/ is an extension entry;
//    it must be registered so the local package loads it.
const candidates = [];
const extensionsDir = resolve(root, 'extensions');
for (const name of readdirSync(extensionsDir)) {
  const full = join(extensionsDir, name);
  if (statSync(full).isDirectory()) {
    const index = join(full, 'index.ts');
    if (existsSync(index)) candidates.push(index);
  } else if (name.endsWith('.ts')) {
    candidates.push(full);
  }
}
for (const candidate of candidates) {
  if (!/^export\s+default\b/m.test(readFileSync(candidate, 'utf8'))) continue; // barrel/helper, not an entry
  assert(listed.has(candidate), `Extension entry not enabled in pi.extensions: ${candidate.slice(root.length)}`);
}

// 2. The project must declare this package locally.
const settingsPath = resolve(root, '.pi', 'settings.json');
assert(existsSync(settingsPath), 'Missing .pi/settings.json (local-first enablement)');
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
const sources = (settings.packages ?? []).map((entry) => (typeof entry === 'string' ? entry : entry?.source));
const enablesRoot = sources.some(
  (source) => typeof source === 'string' && resolve(root, '.pi', source) === root,
);
assert(enablesRoot, '.pi/settings.json must declare this package locally (e.g. "packages": [".."])');

console.log(`Local-first enablement validated (${listed.size} extensions enabled here).`);
