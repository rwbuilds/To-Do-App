// Quick add on the widget: Cmd/Ctrl+Shift+J while collapsed opens a one-line box, Enter adds the
// task through the task box's parsing, Esc and clicking away close it, and the window is asked to
// widen and shrink back. When Jot is open, the shortcut still focuses the task box.
'use strict';
const { open, checker, finish } = require('./helpers');
const { check, done } = checker('widget quick add');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = (w, el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

(async () => {
    const j = open(process.argv[2], { seed: { todos: [], notes: [], groups: ['Work'], sections: {}, settings: { theme: 'purple' } } });
    const { w, doc } = j;
    const calls = [];
    w.widgetAPI = new Proxy({ resizeWindow: s => calls.push(s) }, { get: (t, k) => (k in t ? t[k] : (k === 'then' ? undefined : () => {})) });
    const box = () => doc.getElementById('widgetQuickAdd');
    const input = () => doc.getElementById('widgetQuickInput');
    const isOpen = () => !!box() && !box().hidden;
    if (typeof w.onGlobalQuickAdd !== 'function') w.onGlobalQuickAdd = () => {};   // older page: report failures, don't crash

    w.collapseToWidget();
    calls.length = 0;
    doc.getElementById('todoInput').value = 'half-typed draft';

    // Open and add a task
    w.onGlobalQuickAdd();
    check('the shortcut opens the box while collapsed', isOpen());
    check('the widget window is asked to widen', calls.join() === 'quick-add', calls.join());
    check('focus is in the box', !!input() && doc.activeElement === input());
    check('Jot stays collapsed', w.eval('appState') === 'widget');
    check('the placeholder says where it goes', !!input() && input().placeholder === 'Add a task', input() && input().placeholder);
    if (input()) {
        input().value = 'call bob tomorrow 5pm #home';
        key(w, input(), 'Enter');
    }
    const tomorrow = w.eval("(() => { const d = new Date(); d.setDate(d.getDate() + 1); return localDateStr(d); })()");
    const t = j.data().todos[0];
    check('Enter adds the task with the date, time and tag parsed', !!t && t.text === 'call bob' && t.dueDate === tomorrow && t.dueTime === '17:00' && t.tags.join() === 'home',
        JSON.stringify(t));
    check('the box closes and the window shrinks back', !isOpen() && calls.join() === 'quick-add,widget', calls.join());
    check('the draft in the task box is untouched', doc.getElementById('todoInput').value === 'half-typed draft', doc.getElementById('todoInput').value);

    // Esc closes without adding
    const count = j.data().todos.length;
    w.onGlobalQuickAdd();
    if (input()) { input().value = 'never mind'; key(w, input(), 'Escape'); }
    check('Esc closes without adding', !isOpen() && j.data().todos.length === count);
    check('Esc leaves Jot collapsed', w.eval('appState') === 'widget');

    // Clicking away closes it when empty, but keeps typed text
    w.onGlobalQuickAdd();
    await sleep(350);
    if (input()) { input().blur(); input().dispatchEvent(new w.FocusEvent('blur')); }
    await sleep(20);
    check('clicking away from an empty box closes it', !isOpen());
    w.onGlobalQuickAdd();
    await sleep(350);
    if (input()) { input().value = 'keep me'; input().blur(); input().dispatchEvent(new w.FocusEvent('blur')); }
    await sleep(20);
    check('clicking away keeps a box with text open', isOpen() && input().value === 'keep me');

    // Opening Jot closes the box first
    calls.length = 0;
    w.expandApp();
    check('opening Jot closes the box', !isOpen() && !doc.body.classList.contains('widget-quick-adding'));
    check('the window shrinks before it expands', calls.join() === 'widget,expanded', calls.join());

    // With Jot open, the shortcut focuses the task box as before
    calls.length = 0;
    w.onGlobalQuickAdd();
    await sleep(200);
    check('when Jot is open the shortcut focuses the task box', doc.activeElement === doc.getElementById('todoInput'));
    check('and opens no widget box', !isOpen() && !calls.includes('quick-add'), calls.join());
    check('no script errors', j.errors.length === 0, j.errors.slice(0, 2).join(' | '));
    done();
})().catch(e => { console.log('CRASH', e && e.stack); finish(2); });
