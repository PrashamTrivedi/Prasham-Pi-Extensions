import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

assert.equal(pkg.repository.url, 'https://github.com/PrashamTrivedi/Prasham-Pi-Extensions.git');
assert(Array.isArray(pkg.pi.extensions) && pkg.pi.extensions.length > 0, 'pi.extensions must be a non-empty array');

// Validate every listed entry regardless of how many there are. The exact count
// is intentionally NOT asserted: adding an extension must not require editing
// this script.
for (const entry of pkg.pi.extensions) {
  const path = resolve(root, entry);
  assert(existsSync(path), `Missing entry point: ${entry}`);
  assert(!/test|activity\.ts|ui\.ts/.test(entry), `Helper listed as extension: ${entry}`);
  // A .ts entry cannot be imported by this Node-run script, so scan the source
  // for a default export instead.
  assert(/export\s+default/.test(readFileSync(path, 'utf8')), `Entry has no default export: ${entry}`);
}

for (const path of ['README.md', 'docs/preview.html', 'docs/preview.svg', 'SECURITY.md']) assert(existsSync(resolve(root, path)), `Missing ${path}`);
console.log(`Package manifest and public assets validated (${pkg.pi.extensions.length} extensions).`);
