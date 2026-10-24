// scripts/release.js must leave the files as they were when a check fails, and put them back when
// a later step fails. Each case runs the script in a throwaway git repo in the temp folder, with a
// stand-in npm on PATH so nothing is installed or fetched. It never reaches the commit or push.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { checker } = require('./helpers');
const { check, done } = checker('release script');

const repo = path.join(__dirname, '..');
const script = process.argv[3] ? path.resolve(process.argv[3]) : path.join(repo, 'scripts', 'release.js');
const temps = [];
process.on('exit', () => temps.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }));
const tmp = prefix => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(d); return d; };

// npm stand-in: "npm test" runs the repo's own tests/run.js, and any other npm command fails
const fakeBin = tmp('jot-fake-npm-');
fs.writeFileSync(path.join(fakeBin, 'npm'), '#!/bin/sh\nif [ "$1" = "test" ]; then exec node tests/run.js; fi\necho "fake npm: $*" >&2\nexit 1\n', { mode: 0o755 });
const useFake = process.platform !== 'win32';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
if (useFake) env.PATH = fakeBin + path.delimiter + env.PATH;

function makeRepo({ mainJs = 'console.log(1);\n', htmlVersion = '1.0.0', testsPass = true } = {}) {
    const dir = tmp('jot-release-test-');
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.mkdirSync(path.join(dir, 'tests'));
    fs.copyFileSync(script, path.join(dir, 'scripts', 'release.js'));
    fs.copyFileSync(path.join(repo, 'scripts', 'check-version-sync.js'), path.join(dir, 'scripts', 'check-version-sync.js'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'jot', version: '1.0.0', scripts: { test: 'node tests/run.js' } }, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ name: 'jot', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'jot', version: '1.0.0' } } }, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'index.html'), `<script>const APP_VERSION = '${htmlVersion}';</script>\n`);
    fs.writeFileSync(path.join(dir, 'main.js'), mainJs);
    fs.writeFileSync(path.join(dir, 'preload.js'), 'console.log(2);\n');
    fs.writeFileSync(path.join(dir, 'tests', 'run.js'), `process.exit(${testsPass ? 0 : 1});\n`);
    const g = args => execFileSync('git', args, { cwd: dir, env, stdio: 'pipe' });
    g(['init', '-q']); g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
    return dir;
}
const files = dir => ['package.json', 'index.html', 'package-lock.json'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const commits = dir => execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, env, encoding: 'utf8' }).trim();
function release(dir) {
    const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'release.js'), '1.0.1', 'test release'], { cwd: dir, env, encoding: 'utf8', timeout: 40000 });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function refuses(name, opts, says) {
    const dir = makeRepo(opts);
    const before = files(dir);
    const r = release(dir);
    check(`${name}: the release stops`, r.code !== 0, `exit ${r.code}`);
    check(`${name}: the files are unchanged`, files(dir) === before, r.out.split('\n').slice(-4).join(' | '));
    check(`${name}: nothing is committed`, commits(dir) === '1');
    check(`${name}: it says why`, says.test(r.out), r.out.split('\n').slice(-3).join(' | '));
}

refuses('main.js has a syntax error', { mainJs: 'function (\n' }, /main\.js syntax check failed/);
refuses('the versions already disagree', { htmlVersion: '0.9.0' }, /version check failed/);
if (useFake) {
    refuses('the tests fail', { testsPass: false }, /tests failed/);
    // Everything passes until npm updates package-lock.json, which the stand-in makes fail
    refuses('a step after the bump fails', {}, /files were put back/);
} else {
    console.log('(skipped the cases that need the npm stand-in on Windows)');
}
done();
