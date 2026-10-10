#!/usr/bin/env node
/**
 * Fails if package.json "version" and the APP_VERSION constant in index.html
 * disagree. These are two separate spots with no build step wiring them
 * together, and they have drifted before — this guard catches it in CI and
 * before a release.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const m = html.match(/const\s+APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!m) {
  console.error('check-version-sync: could not find APP_VERSION in index.html');
  process.exit(2);
}
const htmlVersion = m[1];
const pkgVersion = pkg.version;

if (htmlVersion !== pkgVersion) {
  console.error(
    `check-version-sync: MISMATCH\n` +
    `  package.json  = ${pkgVersion}\n` +
    `  index.html    = ${htmlVersion}\n` +
    `Bump both to the same value (or run: npm run release <version>).`
  );
  process.exit(1);
}
console.log(`check-version-sync: OK (${pkgVersion})`);
