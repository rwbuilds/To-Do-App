// "?" opens a keyboard shortcut list (not while typing, not in the widget), Esc and "?" close it,
// focus goes in and comes back, and the keys shown match the platform.
'use strict';
const { open, checker } = require('./helpers');
const { check, done } = checker('shortcut list');

const seed = { todos: [{ id: 'a1aaa', text: 'one' }], notes: [{ id: 'n1abc', title: 'Note', body: 'hi' }], groups: [], sections: {}, settings: { theme: 'purple' } };
const key = (w, el, k, extra = {}) => {
    const ev = new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });
    el.dispatchEvent(ev);
    return ev;
};
const j = open(process.argv[2], { seed });
const { w, doc } = j;
const modal = () => doc.getElementById('shortcutsModal');
const closeBtn = () => doc.getElementById('shortcutsClose') || doc.body;   // body on a page without the list
const isOpen = () => !!modal() && modal().classList.contains('active');
const keysShown = () => [...doc.querySelectorAll('#shortcutList kbd')].map(el => el.textContent);

// Open with ? from a button, check its contents, close with Esc
const opener = doc.getElementById('optionsToggle');
opener.focus();
key(w, opener, '?');
check('? opens the shortcut list', isOpen());
check('it is a labelled modal dialog', (() => {
    const box = doc.querySelector('#shortcutsModal [role="dialog"]');
    return box && box.getAttribute('aria-modal') === 'true' && doc.getElementById(box.getAttribute('aria-labelledby')).textContent === 'Keyboard shortcuts';
})());
check('focus moves into the dialog', doc.activeElement === doc.getElementById('shortcutsClose'));
const win = keysShown();
for (const want of ['Ctrl+Shift+J', 'Ctrl+Shift+Space', '?', 'Esc', 'Ctrl+N', 'Ctrl+click', 'Ctrl+C', 'Space', 'Enter', 'Shift+Enter', 'Ctrl+Enter', 'Ctrl+F', 'Ctrl+Shift+V']) {
    check(`Windows list shows ${want}`, win.includes(want), JSON.stringify(win));
}
key(w, closeBtn(), 'Tab');
check('Tab stays inside the dialog', doc.activeElement === doc.getElementById('shortcutsClose'));
key(w, closeBtn(), 'Escape');
check('Esc closes it', !isOpen());
check('Esc there leaves Jot open', w.eval('appState') === 'expanded', w.eval('appState'));
check('focus goes back to where it was', doc.activeElement === opener);

// ? toggles it closed, and the overlay click closes it
key(w, opener, '?');
key(w, closeBtn(), '?');
check('? again closes it', !isOpen());
key(w, opener, '?');
if (modal()) modal().dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
check('clicking outside the box closes it', !isOpen());

// Not while typing, not with modifier keys
const input = doc.getElementById('todoInput');
input.focus();
const typed = key(w, input, '?');
check('? in the task box types a ? instead', !isOpen() && !typed.defaultPrevented);
key(w, opener, '?', { ctrlKey: true });
check('Ctrl+? does nothing', !isOpen());
w.switchTab('notes');
w.openNoteEditor('n1abc');
const body = doc.getElementById('noteBody');
body.focus();
key(w, body, '?');
check('? in a note types a ? instead', !isOpen());
w.closeNoteEditor();
w.switchTab('todos');

// The Settings button opens it too, and shrinking to the widget closes it
const showBtn = doc.getElementById('showShortcutsBtn');
if (showBtn) showBtn.click();
check('Settings > Keyboard shortcuts opens it', isOpen());
w.collapseToWidget();
check('shrinking to the widget closes it', !isOpen());
key(w, doc.body, '?');
check('? does nothing in the widget', !isOpen());
w.expandApp();

// Mac labels
Object.defineProperty(w.navigator, 'platform', { value: 'MacIntel', configurable: true });
if (typeof w.openShortcuts === 'function') w.openShortcuts();
const mac = keysShown();
for (const want of ['⌘⇧J', '⌘⇧Space', '⌃N', '⌘-click', '⌘C', '⇧Enter', '⌘Enter', '⌘F', '⌘⇧V']) {
    check(`Mac list shows ${want}`, mac.includes(want), JSON.stringify(mac));
}
check('no script errors', j.errors.length === 0, j.errors.slice(0, 2).join(' | '));
done();
