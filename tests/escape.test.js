// Escape should close only the innermost thing: an editor, the find box or a dialog. It should not
// collapse Jot, and a blur after Escape must not save what Escape discarded.
'use strict';
const { open, checker } = require('./helpers');
const { check, done } = checker('escape');

const seed = () => ({
    groups: ['Work'], sections: { Work: [] }, settings: { theme: 'purple' },
    todos: [{ id: 'abc12', text: 'original', group: 'Work', subtasks: [{ text: 'sub one', done: false }, { text: 'sub two', done: false }] }],
    notes: [{ id: 'n1abc', title: 'Note', body: 'hello' }],
});
const esc = (w, el) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
const enter = (w, el) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
const blur = (w, el) => el.dispatchEvent(new w.FocusEvent('blur'));   // what Chromium can send when a focused editor is removed
const fresh = () => { const j = open(process.argv[2], { seed: seed() }); j.state = () => j.w.eval('appState'); return j; };

// Task text editor
let j = fresh();
j.w.startEditTodo('abc12', j.doc.querySelector('.todo-item[data-id="abc12"] .todo-text'));
let input = j.doc.querySelector('.todo-edit-input');
input.value = 'edited';
esc(j.w, input);
check('task editor: Escape keeps Jot open', j.state() === 'expanded', j.state());
check('task editor: Escape discards the edit', j.data().todos[0].text === 'original', j.data().todos[0].text);
blur(j.w, input);
check('task editor: a blur after Escape does not save the edit', j.data().todos[0].text === 'original', j.data().todos[0].text);

// Subtask editor: Escape, then Enter on an emptied subtask followed by a blur
j = fresh();
j.w.editSubtask('abc12', 0, j.doc.querySelector('.subtask-item[data-task-id="abc12"][data-sub-index="0"] .subtask-text'));
input = j.doc.querySelector('.todo-edit-input');
input.value = 'changed';
esc(j.w, input);
check('subtask editor: Escape keeps Jot open', j.state() === 'expanded', j.state());
blur(j.w, input);
check('subtask editor: a blur after Escape does not save', j.data().todos[0].subtasks[0].text === 'sub one', j.data().todos[0].subtasks[0].text);
j.w.editSubtask('abc12', 0, j.doc.querySelector('.subtask-item[data-task-id="abc12"][data-sub-index="0"] .subtask-text'));
input = j.doc.querySelector('.todo-edit-input');
input.value = '';
enter(j.w, input);
blur(j.w, input);
const subs = j.data().todos[0].subtasks.map(s => s.text);
check('subtask editor: emptying one subtask deletes only that one', subs.length === 1 && subs[0] === 'sub two', JSON.stringify(subs));

// Add group box
j = fresh();
j.w.promptAddGroup();
input = j.doc.getElementById('inlineGroupInput');
input.value = 'New group';
esc(j.w, input);
check('add group: Escape keeps Jot open', j.state() === 'expanded', j.state());
blur(j.w, input);
check('add group: a blur after Escape does not add it', !j.data().groups.includes('New group'), JSON.stringify(j.data().groups));

// Add section box
j = fresh();
j.w.promptAddSection('Work');
input = j.doc.querySelector('#todoList input');
check('add section: the box opened', !!input);
if (input) {
    input.value = 'New section';
    esc(j.w, input);
    check('add section: Escape keeps Jot open', j.state() === 'expanded', j.state());
    blur(j.w, input);
    check('add section: a blur after Escape does not add it', !(j.data().sections.Work || []).includes('New section'), JSON.stringify(j.data().sections));
}

// Find box and link box inside a note
j = fresh();
j.w.switchTab && j.w.switchTab('notes');
j.w.openNoteEditor('n1abc');
j.w.openNoteFind();
esc(j.w, j.doc.getElementById('noteFindInput'));
check('note find: Escape closes the find bar', j.doc.getElementById('noteFindBar').style.display === 'none');
check('note find: Escape keeps the note open', j.w.eval('editingNoteId') === 'n1abc', j.w.eval('editingNoteId'));
j.w.fmtLink();
input = j.doc.getElementById('inlineLinkInput');
check('link box: the box opened', !!input);
if (input) {
    input.value = 'example.com';
    esc(j.w, input);
    check('link box: Escape keeps the note open', j.w.eval('editingNoteId') === 'n1abc', j.w.eval('editingNoteId'));
    blur(j.w, input);
    check('link box: a blur after Escape adds no link', !j.doc.querySelector('#noteBody a'), j.doc.getElementById('noteBody').innerHTML.slice(0, 80));
}
esc(j.w, j.doc.body);
check('note: Escape with nothing else open still closes the note', !j.w.eval('editingNoteId'));

// Prompt dialog and schedule dialog
j = fresh();
j.w.showPrompt('Name');
esc(j.w, j.doc.getElementById('promptInput'));
check('prompt: Escape closes the dialog', !j.doc.getElementById('promptModal').classList.contains('active'));
check('prompt: Escape keeps Jot open', j.state() === 'expanded', j.state());
j.w.eval("contextTargetId = 'abc12'");
j.w.ctxEditSchedule();
check('schedule: the dialog opened', j.doc.getElementById('scheduleModal').classList.contains('active'));
esc(j.w, j.doc.getElementById('schedDate'));
check('schedule: Escape closes the dialog', !j.doc.getElementById('scheduleModal').classList.contains('active'));
check('schedule: Escape keeps Jot open', j.state() === 'expanded', j.state());

// With nothing open, Escape still collapses Jot
esc(j.w, j.doc.body);
check('nothing open: Escape still collapses Jot', j.state() === 'widget', j.state());
check('no script errors', j.errors.length === 0, j.errors.slice(0, 2).join(' | '));
done();
