// The page's inline script, main.js and preload.js must all parse.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { checker } = require('./helpers');
const { check, done } = checker('syntax');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(process.argv[2] || path.join(root, 'index.html'), 'utf8');
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, n = 0;
while ((m = re.exec(html))) {
    n++;
    let err = null;
    try { new vm.Script(m[1], { filename: `inline-script-${n}.js` }); } catch (e) { err = e.message; }
    check(`index.html inline script ${n} parses`, !err, err);
}
check('index.html has an inline script', n > 0);
for (const f of ['main.js', 'preload.js']) {
    let err = null;
    try { new vm.Script(fs.readFileSync(path.join(root, f), 'utf8').replace(/^#!.*/, ''), { filename: f }); } catch (e) { err = e.message; }
    check(`${f} parses`, !err, err);
}
done();
