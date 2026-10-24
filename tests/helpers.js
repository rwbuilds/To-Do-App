// Shared helper for Jot's tests. It loads index.html in jsdom the way the app starts, then opens
// the main window. Every test ends through finish(), because Jot's page runs timers that would
// otherwise keep Node alive forever.
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const STORAGE_KEY = 'quicknotes_data';
// The page under test: index.html, or another copy passed on the command line (for example a
// released version, to see whether a bug is new).
const PAGE = process.argv[2] || path.join(__dirname, '..', 'index.html');
const windows = [];

setTimeout(() => { console.log('WATCHDOG: test did not finish within 50s'); finish(3); }, 50000).unref();

function open(pagePath, { seed, rawSeed } = {}) {
    const html = fs.readFileSync(pagePath || PAGE, 'utf8');
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => {
        const d = e && e.detail && e.detail.stack ? e.detail.stack.split('\n').slice(0, 3).map(s => s.trim()).join(' <- ') : '';
        errors.push(String((e && (e.stack || e.message)) || e).split('\n')[0] + (d ? '  [' + d + ']' : ''));
    });
    vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ').slice(0, 200)));
    const dom = new JSDOM(html, {
        url: 'https://jot.invalid/index.html',
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        virtualConsole: vc,
        beforeParse(w) {
            if (rawSeed != null) w.localStorage.setItem(STORAGE_KEY, rawSeed);
            else if (seed) w.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
            w.confirm = () => true;
            w.alerts = [];
            w.alert = m => w.alerts.push(String(m));
            if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
            w.Element.prototype.scrollIntoView = function () {};
            w.scrollTo = () => {};
            // jsdom has no innerText; Jot's note word count reads it
            if (!('innerText' in w.HTMLElement.prototype)) Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
                configurable: true, get() { return this.textContent; }, set(v) { this.textContent = v; },
            });
            // jsdom has no isContentEditable either; Jot's "is the user typing?" checks read it.
            // Chromium's rule: the nearest contenteditable attribute decides ("false" turns it off).
            if (w.HTMLElement.prototype.isContentEditable === undefined) Object.defineProperty(w.HTMLElement.prototype, 'isContentEditable', {
                configurable: true,
                get() {
                    for (let el = this; el && el.nodeType === 1; el = el.parentElement) {
                        const v = el.getAttribute('contenteditable');
                        if (v !== null) return v.toLowerCase() !== 'false';
                    }
                    return false;
                },
            });
        },
    });
    const w = dom.window;
    windows.push(w);
    if (typeof w.expandApp === 'function') w.expandApp();
    return { w, doc: w.document, errors, data: () => w.eval('data') };
}

// Restore a backup through Jot's real importData, the way the Restore button's file input does.
async function restore(jot, backup) {
    const { w, doc } = jot;
    doc.getElementById('toastMsg').textContent = '';
    const before = w.alerts.length;
    const text = typeof backup === 'string' ? backup : JSON.stringify(backup);
    const file = new w.File([text], 'jot-backup.json', { type: 'application/json' });
    w.importData({ target: { files: [file], value: 'jot-backup.json' } });
    for (let i = 0; i < 200; i++) {
        await new Promise(r => setTimeout(r, 5));
        if (doc.getElementById('toastMsg').textContent === 'Backup restored') return;
        if (w.alerts.length > before) throw new Error('restore failed: ' + w.alerts[w.alerts.length - 1]);
    }
    throw new Error('restore did not finish');
}

function finish(code) {
    for (const w of windows) { try { w.close(); } catch (e) {} }
    process.exit(code);
}

// Check recorder: prints a PASS or FAIL line per check and a summary, then exits 1 on any failure.
function checker(label) {
    let pass = 0, fail = 0;
    const check = (name, ok, detail) => {
        if (ok) pass++; else fail++;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? '  -> ' + detail : ''}`);
    };
    const done = () => { console.log(`\n${label}: ${pass} passed, ${fail} failed`); finish(fail ? 1 : 0); };
    return { check, done };
}

module.exports = { open, restore, finish, checker, STORAGE_KEY };
