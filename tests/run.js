// Runs every tests/*.test.js file, each in its own Node process with a 60-second limit, and exits 1
// if any of them fails. Usage: npm test   (or: npm test -- path/to/other/index.html)
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
const extra = process.argv.slice(2);
let failed = 0;
for (const f of files) {
    const r = spawnSync(process.execPath, [path.join(__dirname, f), ...extra], { encoding: 'utf8', timeout: 60000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const summary = out.trim().split('\n').pop();
    const ok = r.status === 0 && /^PASS/m.test(out);   // a PASS line shows the test really ran
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${f}  ${r.error ? '(' + r.error.code + ')' : summary}`);
    if (!ok) console.log(out.split('\n').filter(l => !l.startsWith('PASS')).map(l => '      ' + l).join('\n'));
}
console.log(`\n${files.length - failed} of ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
