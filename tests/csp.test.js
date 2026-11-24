// index.html carries a Content-Security-Policy that blocks every remote load, and the page doesn't
// rely on anything that policy would break (external files, eval, string timers). jsdom doesn't
// enforce CSP, so this checks the policy text and the page source.
'use strict';
const fs = require('fs');
const path = require('path');
const { checker } = require('./helpers');
const { check, done } = checker('content security policy');

const html = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'index.html'), 'utf8');
const head = (html.match(/<head>([\s\S]*?)<\/head>/i) || [])[1] || '';
const metas = [...head.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/gi)];
check('there is exactly one CSP meta tag, in <head>', metas.length === 1, String(metas.length));
const firstScript = html.search(/<script/i);
check('the CSP comes before the first script', metas.length === 1 && html.indexOf(metas[0][0]) < firstScript);

const policy = {};
for (const part of (metas[0] ? metas[0][1] : '').split(';')) {
    const [name, ...vals] = part.trim().split(/\s+/);
    if (name) policy[name] = vals;
}
const is = (dir, want) => JSON.stringify(policy[dir] || []) === JSON.stringify(want);
check("default-src is 'none'", is('default-src', ["'none'"]), JSON.stringify(policy['default-src']));
check('scripts: inline only, no remote, no eval', is('script-src', ["'unsafe-inline'"]), JSON.stringify(policy['script-src']));
check('styles: inline only', is('style-src', ["'unsafe-inline'"]), JSON.stringify(policy['style-src']));
check('images: data: and https: only (pasted note images)', is('img-src', ['data:', 'https:']), JSON.stringify(policy['img-src']));
for (const d of ['connect-src', 'object-src', 'frame-src', 'worker-src', 'media-src', 'base-uri', 'form-action']) {
    check(`${d} is 'none'`, is(d, ["'none'"]), JSON.stringify(policy[d]));
}
check('nothing allows *, http: or unsafe-eval', !/(^|\s)\*(\s|;|$)|http:|unsafe-eval/.test(metas[0] ? metas[0][1] : ''));

// Things the policy would silently break at runtime
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
check('no external <script src>', !/<script\b[^>]*\bsrc=/i.test(html));
check('no <link> stylesheets or other linked files', !/<link\b/i.test(html));
check('no <iframe>, <object> or <embed>', !/<(iframe|object|embed)\b/i.test(html));
const code = scripts.map(m => m[1]).join('\n');
check('no eval or new Function', !/\beval\s*\(|new\s+Function\s*\(/.test(code));
check('no string timers', !/set(Timeout|Interval)\s*\(\s*['"`]/.test(code));
check('no fetch or XMLHttpRequest from the page', !/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|EventSource\s*\(/.test(code));
done();
