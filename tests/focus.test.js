// After Delete or Duplicate, keyboard focus stays on a task instead of falling back to the page,
// and it's never taken from the task box.
'use strict';
const { open, checker } = require('./helpers');
const { check, done } = checker('focus after delete and duplicate');

const seed = {
    groups: [], sections: {}, notes: [], settings: { theme: 'purple' },
    todos: ['a', 'b', 'c', 'd', 'e'].map(x => ({ id: x + '1aaa', text: 'task ' + x })),
};
const j = open(process.argv[2], { seed });
const { w, doc } = j;
const shown = () => [...doc.querySelectorAll('#todoList .todo-item')].map(r => r.dataset.id);
const checkOf = id => doc.querySelector(`#todoList .todo-item[data-id="${id}"] .todo-check`);
const rowBtn = (id, sel) => doc.querySelector(`#todoList .todo-item[data-id="${id}"] ${sel}`);
const focusedTask = () => { const r = doc.activeElement && doc.activeElement.closest && doc.activeElement.closest('.todo-item'); return r ? r.dataset.id : `(${doc.activeElement && doc.activeElement.id || doc.activeElement && doc.activeElement.tagName})`; };
const menuItem = text => [...doc.querySelectorAll('#contextMenu .context-menu-item')].find(el => el.textContent.trim() === text);

// Trash button on a middle task: focus goes to the next task
let order = shown();
const mid = order[1], after = order[2];
rowBtn(mid, '.todo-action-btn.delete').focus();
rowBtn(mid, '.todo-action-btn.delete').click();
check('the task is deleted', !shown().includes(mid));
check('focus moves to the next task\'s checkbox', doc.activeElement === checkOf(after), `focused ${focusedTask()}, wanted ${after}`);

// Trash button on the last task: focus goes to the one before it
order = shown();
const last = order[order.length - 1], before = order[order.length - 2];
rowBtn(last, '.todo-action-btn.delete').focus();
rowBtn(last, '.todo-action-btn.delete').click();
check('deleting the last task moves focus to the one before it', doc.activeElement === checkOf(before), `focused ${focusedTask()}, wanted ${before}`);

// Delete from the ⋯ menu, by keyboard
order = shown();
const target = order[0], next = order[1];
rowBtn(target, '.todo-more-btn').focus();
rowBtn(target, '.todo-more-btn').click();
menuItem('Delete').focus();
menuItem('Delete').click();
check('Delete from the ⋯ menu moves focus to the next task', doc.activeElement === checkOf(next), `focused ${focusedTask()}, wanted ${next}`);
check('the menu closed', doc.getElementById('contextMenu').style.display === 'none');

// Duplicate from the ⋯ menu, by keyboard: focus goes to the copy
order = shown();
const orig = order[0];
rowBtn(orig, '.todo-more-btn').focus();
rowBtn(orig, '.todo-more-btn').click();
menuItem('Duplicate').focus();
menuItem('Duplicate').click();
const copy = j.data().todos.find(t => t.text === j.data().todos.find(x => x.id === orig).text && t.id !== orig);
check('Duplicate made a copy', !!copy);
check('focus moves to the copy\'s checkbox', !!copy && doc.activeElement === checkOf(copy.id), `focused ${focusedTask()}, wanted ${copy && copy.id}`);

// Focus in the task box is left alone
const input = doc.getElementById('todoInput');
input.focus();
w.deleteTodo(shown()[0]);
check('deleting while typing in the task box leaves focus there', doc.activeElement === input, `focused ${focusedTask()}`);

// Deleting the only task left moves focus to the task box
while (shown().length > 1) w.deleteTodo(shown()[0]);
const only = shown()[0];
rowBtn(only, '.todo-action-btn.delete').focus();
rowBtn(only, '.todo-action-btn.delete').click();
check('deleting the last remaining task moves focus to the task box', doc.activeElement === input, `focused ${focusedTask()}`);
check('no script errors', j.errors.length === 0, j.errors.slice(0, 2).join(' | '));
done();
