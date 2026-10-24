// Typing in a note saves once typing pauses (400 ms), not on every keystroke. Everything that
// leaves the note, reads it, or replaces the data saves a waiting edit first, and a waiting save
// never lands in another note or in restored data.
'use strict';
const { open, restore, checker, STORAGE_KEY } = require('./helpers');
const { check, done } = checker('note saving');

const OLD = '2026-01-01T00:00:00.000Z';
const seed = {
    groups: [], sections: {}, settings: { theme: 'purple' }, todos: [],
    notes: [
        { id: 'n1abc', title: 'First', body: 'one', bodyHtml: '<p>one</p>', tags: [], folder: '', updatedAt: OLD },
        { id: 'n2abc', title: 'Second', body: 'two', bodyHtml: '<p>two</p>', tags: [], folder: '', updatedAt: OLD },
    ],
};
const j = open(process.argv[2], { seed });
const { w, doc } = j;

// Count Jot's writes to its storage
let writes = 0;
const setItem = w.Storage.prototype.setItem;
w.Storage.prototype.setItem = function (k, v) { if (k === STORAGE_KEY) writes++; return setItem.call(this, k, v); };

// jsdom has no URL.createObjectURL; keep each exported file so its name and text can be read
const exported = [];
w.URL.createObjectURL = blob => { exported.push({ blob }); return 'blob:jot-test'; };
w.URL.revokeObjectURL = () => {};
w.HTMLAnchorElement.prototype.click = function () { if (exported.length) exported[exported.length - 1].name = this.download; };
const readBlob = blob => new Promise(res => { const r = new w.FileReader(); r.onload = () => res(String(r.result)); r.readAsText(blob); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const stored = () => JSON.parse(w.localStorage.getItem(STORAGE_KEY));
const storedNote = id => stored().notes.find(n => n.id === id) || {};
const body = () => doc.getElementById('noteBody');
const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
const typeBody = text => { body().innerHTML = '<p>' + text + '</p>'; fire(body(), 'input'); };
const typeInto = (id, text) => { const el = doc.getElementById(id); el.value = text; fire(el, 'input'); };
const openNote = id => { if (w.eval('currentTab') !== 'notes') w.switchTab('notes'); w.openNoteEditor(id); writes = 0; };

(async () => {
    // Typing waits for a pause, then saves once
    openNote('n1abc');
    for (let i = 1; i <= 10; i++) typeBody('alpha beta ' + 'x'.repeat(i));
    check('ten keystrokes in a note save nothing straight away', writes === 0, writes + ' writes');
    check('the word count still updates straight away', /^3 words/.test(doc.getElementById('noteCharCount').textContent),
        doc.getElementById('noteCharCount').textContent);
    await sleep(600);
    check('one save once typing pauses', writes === 1, writes + ' writes');
    check('that save has the last keystroke', storedNote('n1abc').bodyHtml.includes('x'.repeat(10)), storedNote('n1abc').bodyHtml);

    // A direct save (paste, formatting) covers the waiting one
    openNote('n1abc');
    typeBody('pasted');
    w.saveCurrentNote();
    await sleep(600);
    check('a direct save cancels the waiting one', writes === 1, writes + ' writes');

    // Closing, switching notes, tabs, collapsing and quitting all save a waiting edit at once
    openNote('n1abc');
    typeBody('closing text');
    w.closeNoteEditor();
    check('closing the note saves at once', storedNote('n1abc').bodyHtml.includes('closing text'));
    openNote('n1abc');
    w.closeNoteEditor();
    check('closing an unchanged note writes nothing', writes === 0, writes + ' writes');

    openNote('n1abc');
    typeBody('switch text');
    w.openNoteEditor('n2abc');
    check('opening another note saves the first one', storedNote('n1abc').bodyHtml.includes('switch text'), storedNote('n1abc').bodyHtml);
    await sleep(600);
    check('the other note is left alone', storedNote('n2abc').updatedAt === OLD && storedNote('n2abc').bodyHtml === '<p>two</p>',
        JSON.stringify(storedNote('n2abc')));

    openNote('n1abc');
    typeBody('tab text');
    w.switchTab('todos');
    check('switching to Tasks saves at once', storedNote('n1abc').bodyHtml.includes('tab text'));

    openNote('n1abc');
    typeBody('collapse text');
    w.collapseToWidget();
    check('collapsing to the widget saves at once', storedNote('n1abc').bodyHtml.includes('collapse text'));
    w.expandApp();

    openNote('n1abc');
    typeBody('click-away text');
    w.collapseUIOnly();   // the main process collapsed Jot after a click outside it
    check('collapsing after a click outside saves at once', storedNote('n1abc').bodyHtml.includes('click-away text'));
    w.expandApp();

    openNote('n1abc');
    typeBody('quit text');
    w.dispatchEvent(new w.Event('beforeunload'));
    check('quitting saves at once', storedNote('n1abc').bodyHtml.includes('quit text'));

    // Title and tags wait the same way, and save when you leave the field
    openNote('n1abc');
    typeInto('noteTitle', 'New title');
    check('typing a title saves nothing straight away', writes === 0, writes + ' writes');
    fire(doc.getElementById('noteTitle'), 'blur');
    check('leaving the title saves it', storedNote('n1abc').title === 'New title', storedNote('n1abc').title);
    writes = 0;
    typeInto('noteTagsInput', 'Work, home');
    check('typing tags saves nothing straight away', writes === 0, writes + ' writes');
    fire(doc.getElementById('noteTagsInput'), 'blur');
    check('leaving the tags saves them', JSON.stringify(storedNote('n1abc').tags) === '["Work","home"]', JSON.stringify(storedNote('n1abc').tags));

    // Exports include a waiting edit
    openNote('n1abc');
    typeInto('noteTitle', 'Export me');
    exported.length = 0;
    w.exportCurrentNote('md');
    check('exporting the note uses the latest title', exported[0] && exported[0].name === 'Export me.md', exported[0] && exported[0].name);
    typeBody('backup text');
    exported.length = 0;
    w.exportData();
    const backup = exported[0] ? await readBlob(exported[0].blob) : '';
    check('a backup export includes a waiting edit', backup.includes('backup text'));

    // Deleting keeps the latest text for Undo
    openNote('n1abc');
    typeBody('last words');
    w.deleteCurrentNote();
    w.undoLastDelete();
    check('Undo after deleting brings back the latest text', storedNote('n1abc').bodyHtml.includes('last words'), storedNote('n1abc').bodyHtml);

    // A waiting save never lands in restored or reset data
    openNote('n1abc');
    typeBody('typed before restore');
    await restore(j, { todos: [], notes: [{ id: 'n1abc', title: 'First', body: 'from backup', bodyHtml: '<p>from backup</p>', updatedAt: OLD }] });
    await sleep(600);
    check('a restore is not overwritten by a waiting save', storedNote('n1abc').bodyHtml === '<p>from backup</p>', storedNote('n1abc').bodyHtml);

    openNote('n1abc');
    typeBody('typed before reset');
    w.resetAllData();
    await sleep(600);
    check('a reset stays empty after a waiting save', stored().notes.length === 0, stored().notes.length + ' notes');

    check('no page errors', j.errors.length === 0, j.errors.join(' | '));
    done();
})().catch(e => { check('test ran to the end', false, e && e.stack); done(); });
