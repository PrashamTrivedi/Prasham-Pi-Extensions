import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
assert.equal(pkg.repository.url, 'https://github.com/PrashamTrivedi/Prasham-Pi-Extensions.git');
assert.equal(pkg.pi.extensions.length, 5);
for (const entry of pkg.pi.extensions) {
  assert(existsSync(resolve(root, entry)), `Missing entry point: ${entry}`);
  assert(!/test|activity\.ts|ui\.ts/.test(entry), `Helper listed as extension: ${entry}`);
}
for (const path of ['README.md', 'docs/preview.html', 'docs/preview.svg', 'SECURITY.md']) assert(existsSync(resolve(root, path)), `Missing ${path}`);
console.log('Package manifest and public assets validated.');
