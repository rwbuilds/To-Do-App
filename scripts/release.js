#!/usr/bin/env node
/**
 * One-command release:   npm run release <x.y.z> "What changed"
 *
 * Contract: stage the changes that should ship (git add <files>), then run
 * this. It refuses to run while tracked files have unstaged edits, so nothing
 * is silently left out of a release. Then it:
 *   1. checks the version is new and higher than the current one,
 *   2. checks main.js and preload.js syntax and version sync, and runs the tests, before it
 *      changes anything,
 *   3. bumps the version in package.json, index.html (APP_VERSION) and
 *      package-lock.json, keeping each file's formatting, and puts the files back if that fails,
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

// 3. Check everything that can be checked before writing any file, so a failed check leaves the
//    repo as it was. (This used to bump the files first, and a failed check left them changed.)
const run = (what, cmd, args) => {
  try { execFileSync(cmd, args, { cwd: root, stdio: 'inherit' }); }
  catch (e) { fail(`${what} failed, so nothing was changed. Fix it, then run this again.`); }
};
run('the main.js syntax check', process.execPath, ['--check', path.join(root, 'main.js')]);
run('the preload.js syntax check', process.execPath, ['--check', path.join(root, 'preload.js')]);
run('the version check', process.execPath, [path.join(root, 'scripts', 'check-version-sync.js')]);
console.log('\nRunning the tests...');
// Fixed command string (no user input), run through the shell so npm.cmd works on Windows.
try { execSync('npm test', { cwd: root, stdio: 'inherit' }); }
catch (e) { fail('the tests failed, so nothing was changed. Fix them, then run this again.'); }

// 4. Bump the version with a text replace so formatting is untouched. The new text is built and
//    checked in memory first, and if a later step fails the files are put back.
const files = ['package.json', 'index.html', 'package-lock.json'];
const originals = {};
for (const f of files) originals[f] = fs.readFileSync(path.join(root, f), 'utf8');
const bumped = (file, re) => {
  const after = originals[file].replace(re, `$1${version}$2`);
  if (after === originals[file]) fail(`could not find the version string in ${file}`);
  return after;
};
const nextPkg = bumped('package.json', /("version"\s*:\s*")[^"]+(")/);
const nextHtml = bumped('index.html', /(const\s+APP_VERSION\s*=\s*['"])[^'"]+(['"])/);
const htmlVersion = (nextHtml.match(/const\s+APP_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1];
if (JSON.parse(nextPkg).version !== version || htmlVersion !== version) {
  fail('the new version would not be the same in package.json and index.html, so nothing was changed.');
}
try {
  fs.writeFileSync(path.join(root, 'package.json'), nextPkg);
  fs.writeFileSync(path.join(root, 'index.html'), nextHtml);
  execSync('npm install --package-lock-only --ignore-scripts --no-audit --no-fund', { cwd: root, stdio: 'pipe' });
  execFileSync(process.execPath, [path.join(root, 'scripts', 'check-version-sync.js')], { cwd: root, stdio: 'inherit' });
} catch (e) {
  for (const f of files) fs.writeFileSync(path.join(root, f), originals[f]);
  fail('updating the version failed, so the files were put back as they were:\n  ' + String((e && e.message) || e).split('\n')[0]);
}
console.log(`Bumped v${current} -> v${version}`);

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
