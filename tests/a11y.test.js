// Screen readers: the undo toast is announced, the prompt is a labelled dialog that keeps Tab
// inside and gives focus back, and the view tabs report which one is selected.
'use strict';
const { open, checker, finish } = require('./helpers');
const { check, done } = checker('accessibility');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = (w, el, k, extra = {}) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));

(async () => {
    const j = open(process.argv[2], { seed: { todos: [{ id: 'a1aaa', text: 'one' }], notes: [], groups: [], sections: {}, settings: { theme: 'purple' } } });
    const { w, doc } = j;

    // Undo toast
    const toast = doc.getElementById('undoToast');
    check('the undo toast is a polite live region', toast.getAttribute('role') === 'status' && toast.getAttribute('aria-live') === 'polite',
        `role=${toast.getAttribute('role')} aria-live=${toast.getAttribute('aria-live')}`);
    w.deleteTodo('a1aaa');
    check('deleting a task puts its message in the live region', /deleted/i.test(doc.getElementById('toastMsg').textContent), doc.getElementById('toastMsg').textContent);

    // Prompt dialog
    const opener = doc.getElementById('optionsToggle');
    opener.focus();
    const answer = w.showPrompt('New folder name:');
    await sleep(80);   // showPrompt focuses its field after 30 ms
    const box = doc.querySelector('#promptModal .modal-box');
    const input = doc.getElementById('promptInput');
    check('the prompt is a modal dialog', box.getAttribute('role') === 'dialog' && box.getAttribute('aria-modal') === 'true',
        `role=${box.getAttribute('role')} aria-modal=${box.getAttribute('aria-modal')}`);
    const titleEl = doc.getElementById(box.getAttribute('aria-labelledby') || 'none');
    check('the dialog is named by its title', !!titleEl && titleEl.textContent === 'New folder name:');
    check('the text field is named by the title too', input.getAttribute('aria-labelledby') === 'promptTitle');
    check('focus starts in the text field', doc.activeElement === input);
    const buttons = [...box.querySelectorAll('button')];
    const last = buttons[buttons.length - 1];
    last.focus();
    key(w, last, 'Tab');
    check('Tab on the last button wraps to the text field', doc.activeElement === input);
    input.focus();
    key(w, input, 'Tab', { shiftKey: true });
    check('Shift+Tab on the text field wraps to the last button', doc.activeElement === last);
    input.focus();
    key(w, input, 'Escape');
    check('Esc closes the dialog', !doc.getElementById('promptModal').classList.contains('active'));
    check('focus goes back to what opened it', doc.activeElement === opener);
    check('Esc answers null', (await answer) === null);

    // View tabs
    const tabs = () => [...doc.querySelectorAll('.tabs [role="tab"]')].map(t => `${t.getAttribute('aria-label') || t.textContent.trim()}=${t.getAttribute('aria-selected')}`).join(' ');
    check('the tabs sit in a tablist', doc.querySelector('.tabs').getAttribute('role') === 'tablist');
    check('Tasks starts selected', tabs() === 'Tasks=true Notes=false Settings=false', tabs());
    w.switchTab('notes');
    check('switching to Notes selects it', tabs() === 'Tasks=false Notes=true Settings=false', tabs());
    w.openSettings();
    check('opening Settings selects it', tabs() === 'Tasks=false Notes=false Settings=true', tabs());
    w.switchTab('todos');
    check('back to Tasks', tabs() === 'Tasks=true Notes=false Settings=false', tabs());
    check('each tab names the panel it shows', [...doc.querySelectorAll('.tabs [role="tab"]')].every(t => doc.getElementById(t.getAttribute('aria-controls') || 'none')));
    check('no script errors', j.errors.length === 0, j.errors.slice(0, 2).join(' | '));
    done();
})().catch(e => { console.log('CRASH', e && e.stack); finish(2); });
