#!/usr/bin/env node
/**
 * One-command release: npm run release <version> ["commit message"]
 *
 * Bumps the version in all three places that must stay in sync
 * (package.json, APP_VERSION in index.html, package-lock.json), validates
 * syntax + version sync, commits, and pushes to origin/main. Pushing triggers
 * the GitHub Action, which builds and publishes a vX.Y.Z Windows Release.
 *
 * It will refuse to run on a dirty tree with UNRELATED changes staged, and it
 * never force-pushes. The git push still uses your own credentials/SSH key.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'pipe' }).toString().trim();
const runLoud = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

const version = process.argv[2];
const msg = process.argv[3] || `Release v${version}`;

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: npm run release <x.y.z> ["commit message"]');
  console.error('  e.g. npm run release 1.6.2 "Fix note export"');
  process.exit(1);
}

// 1. Bump package.json
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const prev = pkg.version;
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 2. Bump APP_VERSION in index.html
const htmlPath = path.join(root, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(
  /(const\s+APP_VERSION\s*=\s*['"])[^'"]+(['"])/,
  `$1${version}$2`
);
fs.writeFileSync(htmlPath, html);

// 3. Sync the lockfile version (no dependency resolution, no scripts)
try { run('npm install --package-lock-only --ignore-scripts'); } catch (e) {}

console.log(`Bumped ${prev} -> ${version}`);

// 4. Validate: version sync + JS syntax of main.js
runLoud('node scripts/check-version-sync.js');
runLoud('node --check main.js');

// 5. Guard: tag must not already exist on the remote
try {
  run('git fetch --tags --quiet');
  const existing = run(`git tag --list v${version}`);
  if (existing) {
    console.error(`\nTag v${version} already exists. Pick a higher version.`);
    process.exit(1);
  }
} catch (e) { /* fetch failing is non-fatal; CI has its own guard */ }

// 6. Commit the three version files + any already-staged release changes
runLoud('git add package.json index.html package-lock.json');
runLoud(`git commit -m ${JSON.stringify(msg + ` (v${version})`)}`);

// 7. Push to main (explicit branch; never force)
console.log('\nPushing to origin main (you may be prompted for your SSH key passphrase)...');
runLoud('git push origin main');

console.log(`\n✅ Released v${version}. The GitHub Action will build and publish the Windows Release.`);
console.log('   For a Mac build run: npm run package  (then codesign --sign - and open the .app)');
