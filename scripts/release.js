#!/usr/bin/env node
/**
 * One-command release:   npm run release <x.y.z> "What changed"
 *
 * Contract: stage the changes that should ship (git add <files>), then run
 * this. It refuses to run while tracked files have unstaged edits, so nothing
 * is silently left out of a release. Then it:
 *   1. checks the version is new and higher than the current one,
 *   2. bumps the version in package.json, index.html (APP_VERSION) and
 *      package-lock.json, keeping each file's formatting,
 *   3. validates version sync and main.js syntax,
 *   4. commits the staged changes plus the version files and pushes to
 *      origin main, which triggers the GitHub Action that publishes the
 *      Windows release.
 * It never force-pushes. The push uses your own git credentials.
 */
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
// Arguments are passed straight to git (no shell), so a commit message with
// backticks or $(...) is never executed.
const git = (args, loud = false) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: loud ? 'inherit' : 'pipe' });
const fail = (msg) => { console.error(`\nrelease: ${msg}`); process.exit(1); };

const version = process.argv[2];
const description = (process.argv[3] || '').trim();
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  fail('usage: npm run release <x.y.z> "What changed"');
}
const message = description ? `${description} (v${version})` : `Release v${version}`;

// 1. Every tracked change must be staged, or it would miss the release.
const unstaged = git(['diff', '--name-only']).split('\n').filter(Boolean);
if (unstaged.length) {
  fail('these files have unstaged changes:\n  ' + unstaged.join('\n  ') +
       '\nStage them to include them (git add <file>) or stash them, then run again.');
}

// 2. The version must be new and higher than the current one.
try { git(['fetch', '--tags', '--quiet']); }
catch (e) { console.warn('release: could not fetch tags from origin; checking local tags only'); }
if (git(['tag', '--list', `v${version}`]).trim()) fail(`tag v${version} already exists. Use a higher version.`);
const current = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const isNewer = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
if (!isNewer(version, current)) fail(`v${version} is not higher than the current v${current}.`);

// 3. Bump the version with a text replace so formatting is untouched.
const bump = (file, re) => {
  const p = path.join(root, file);
  const before = fs.readFileSync(p, 'utf8');
  const after = before.replace(re, `$1${version}$2`);
  if (after === before) fail(`could not find the version string in ${file}`);
  fs.writeFileSync(p, after);
};
bump('package.json', /("version"\s*:\s*")[^"]+(")/);
bump('index.html', /(const\s+APP_VERSION\s*=\s*['"])[^'"]+(['"])/);
// Fixed command string (no user input), run through the shell so npm.cmd works on Windows.
execSync('npm install --package-lock-only --ignore-scripts --no-audit --no-fund', { cwd: root, stdio: 'pipe' });
console.log(`Bumped v${current} -> v${version}`);

// 4. Validate before committing anything.
execFileSync(process.execPath, [path.join(root, 'scripts', 'check-version-sync.js')], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, ['--check', path.join(root, 'main.js')], { cwd: root, stdio: 'inherit' });

// 5. Commit the staged changes plus the version files, then push.
git(['add', 'package.json', 'index.html', 'package-lock.json']);
console.log('\nIncluded in this release:\n  ' + git(['diff', '--cached', '--name-only']).trim().split('\n').join('\n  '));
const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
if (untracked.length) console.log('Not included (untracked):\n  ' + untracked.join('\n  '));
git(['commit', '-m', message], true);

console.log('\nPushing to origin main (you may be asked for your SSH key passphrase)...');
try {
  git(['push', 'origin', 'main'], true);
} catch (e) {
  fail('the push failed. The release commit exists locally; fix the problem, then run: git push origin main');
}
console.log(`\nReleased v${version}. GitHub Actions will build and publish the Windows release.`);
console.log('Mac app: npm run package, then codesign --force --deep --sign - the .app in out/ and copy it to /Applications.');
