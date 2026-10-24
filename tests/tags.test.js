// Tags: task search and the Notes-tab task hint ignore case, and a note's tag field drops
// repeats and strips every leading #.
'use strict';
const { open, checker } = require('./helpers');
const { check, done } = checker('tags');

const seed = {
    groups: [], sections: {}, settings: { theme: 'purple' },
    todos: [{ id: 't1aaa', text: 'pay bills', tags: ['Finance'] }, { id: 't2aaa', text: 'walk', tags: [] }],
    notes: [{ id: 'n1abc', title: 'note', body: 'finance notes', updatedAt: new Date().toISOString() }],
};
const j = open(process.argv[2], { seed });
const { w, doc } = j;

// Task search
doc.getElementById('searchTodos').value = 'finance';
w.renderTodos();
const rows = [...doc.querySelectorAll('#todoList .todo-item')].map(r => r.dataset.id);
check('task search "finance" finds the task tagged Finance', rows.includes('t1aaa'), JSON.stringify(rows));
check('task search still hides tasks that don\'t match', !rows.includes('t2aaa'), JSON.stringify(rows));
doc.getElementById('searchTodos').value = '';
w.renderTodos();

// Notes-tab hint
w.switchTab('notes');
doc.getElementById('searchNotes').value = 'finance';
w.renderNotes();
const hint = [...doc.querySelectorAll('#noteList div')].find(d => /matching task/.test(d.textContent));
check('the Notes search hint counts the task tagged Finance', !!hint && /\b1 matching task/.test(hint.textContent), hint ? hint.textContent : '(no hint)');
doc.getElementById('searchNotes').value = '';
w.renderNotes();

// Note tag field
w.openNoteEditor('n1abc');
doc.getElementById('noteTagsInput').value = '#Work, work, ##idea, , WORK, #idea, home';
w.onNoteTagsChange();
const tags = j.data().notes[0].tags;
check('note tags drop repeats and every leading #', JSON.stringify(tags) === JSON.stringify(['Work', 'idea', 'home']), JSON.stringify(tags));
check('no script errors', j.errors.length === 0, j.errors.slice(0, 2).join(' | '));
done();
