// Keyboard: task and subtask checkboxes take Tab focus and toggle with Space and Enter, focus
// survives the redraw, and the ⋯ menu's Rename opens the editor. Duplicate copies subtasks.
'use strict';
const { open, checker } = require('./helpers');
const { check, done } = checker('keyboard and duplicate');

const seed = {
    groups: [], sections: {}, settings: { theme: 'purple' }, notes: [],
    todos: [
        { id: 'a1aaa', text: 'first' },
        { id: 'a2aaa', text: 'second', tags: ['home'], subtasks: [{ text: 'step', done: false }] },
        { id: 'a3aaa', text: 'third' },
    ],
};
const key = (w, el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const j = open(process.argv[2], { seed });
const { w, doc } = j;
const task = id => j.data().todos.find(t => t.id === id);
const check1 = id => doc.querySelector(`#todoList .todo-item[data-id="${id}"] .todo-check`);
const active = () => doc.activeElement;

// Task checkbox
w.setFilter('all');
let box = check1('a1aaa');
check('checkbox has role=checkbox', box && box.getAttribute('role') === 'checkbox', box && box.getAttribute('role'));
check('checkbox is in the Tab order', box && box.tabIndex === 0, box && box.tabIndex);
check('checkbox reports not checked', box && box.getAttribute('aria-checked') === 'false', box && box.getAttribute('aria-checked'));
box.focus();
key(w, box, ' ');
check('Space completes the task', task('a1aaa').completed === true);
check('focus stays on that task\'s checkbox after the redraw', active() === check1('a1aaa'), active() && active().className);
check('checkbox now reports checked', check1('a1aaa').getAttribute('aria-checked') === 'true');
key(w, check1('a1aaa'), 'Enter');
check('Enter un-completes it', task('a1aaa').completed === false);

// In the Active view a completed task leaves the list, so focus moves to the next checkbox
w.setFilter('active');
check1('a1aaa').focus();
key(w, check1('a1aaa'), ' ');
check('Active view: the completed task leaves the list', !check1('a1aaa'));
check('Active view: focus moves to the next task\'s checkbox', active() === check1('a2aaa'), active() && (active().closest('.todo-item') || {}).dataset);
key(w, check1('a2aaa'), 'a');
check('other keys do nothing', task('a2aaa').completed === false);

// Subtask checkbox
const subBox = () => doc.querySelector('#todoList .subtask-item[data-task-id="a2aaa"][data-sub-index="0"] .subtask-check');
check('subtask checkbox is in the Tab order', subBox() && subBox().tabIndex === 0 && subBox().getAttribute('role') === 'checkbox');
subBox().focus();
key(w, subBox(), ' ');
check('Space ticks the subtask', task('a2aaa').subtasks[0].done === true);
check('focus stays on the subtask checkbox', active() === subBox());

// Rename from the ⋯ menu, by keyboard. jotMenuItems() keeps only items with a layout box, and
// jsdom has no layout, so give elements a box unless they or a parent are display:none.
w.HTMLElement.prototype.getClientRects = function () {
    for (let el = this; el; el = el.parentElement) if (el.style && el.style.display === 'none') return [];
    return [{ width: 1, height: 1 }];
};
const more = doc.querySelector('#todoList .todo-item[data-id="a3aaa"] .todo-more-btn');
more.focus();
more.click();
const rename = [...doc.querySelectorAll('#contextMenu .context-menu-item')].find(el => el.textContent.trim() === 'Rename');
check('the ⋯ menu has a Rename item', !!rename);
if (rename) {
    rename.focus();
    key(w, rename, 'Enter');
    const editor = doc.querySelector('#todoList .todo-edit-input');
    check('Rename opens the editor with focus in it', !!editor && active() === editor);
    check('the menu closed', doc.getElementById('contextMenu').style.display === 'none');
    if (editor) {
        editor.value = 'third, renamed';
        key(w, editor, 'Enter');
        check('Enter saves the new name', task('a3aaa').text === 'third, renamed', task('a3aaa').text);
    }
}

// Duplicate copies the subtask and tag lists
w.eval("contextTargetId = 'a2aaa'");
w.ctxDuplicate();
const dup = j.data().todos.find(t => t.text === 'second' && t.id !== 'a2aaa');
check('Duplicate made a copy', !!dup);
if (dup) {
    check('the copy has its own subtask list', dup.subtasks !== task('a2aaa').subtasks);
    check('the copy has its own tag list', dup.tags !== task('a2aaa').tags);
    w.toggleSubtask(dup.id, 0);
    check('unticking the copy\'s subtask leaves the original ticked', task('a2aaa').subtasks[0].done === true && dup.subtasks[0].done === false,
        JSON.stringify([task('a2aaa').subtasks[0].done, dup.subtasks[0].done]));
}
check('no script errors', j.errors.length === 0, j.errors.slice(0, 2).join(' | '));
done();
