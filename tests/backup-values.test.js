// A crafted backup must not be able to run code in Jot, through a restore or at startup.
// Each payload bumps window.__ran when it runs.
'use strict';
const { open, restore, checker, finish } = require('./helpers');
const { check, done } = checker('backup values');

const RUN = 'window.__ran=(window.__ran||0)+1';
const badId = `x');${RUN};('`;                                    // breaks out of toggleTodo('<id>')
const badPriority = `x" onmouseover="${RUN}`;                       // breaks out of the row's class attribute
const badRepeat = `<b id="inj-repeat" onmouseover="${RUN}">x</b>`;  // markup in the repeat tag
const badTime = `<b id="inj-time" onmouseover="${RUN}">x</b>`;      // markup in the due date tag
const good = { id: 'ok1aa', text: 'good', priority: 'high', repeat: 'weekly', dueDate: '2030-01-15', dueTime: '09:30', tags: ['work'], subtasks: [{ text: 'sub', done: false }] };
const crafted = {
    groups: [], sections: {}, settings: { theme: 'purple' },
    todos: [
        { id: badId, text: 'bad id' },
        { id: 'p1aaa', text: 'bad priority', priority: badPriority },
        { id: 'r1aaa', text: 'bad repeat', repeat: badRepeat },
        { id: 't1aaa', text: 'bad time', dueDate: '2030-01-15', dueTime: badTime },
        good,
    ],
    notes: [{ id: badId, title: 'bad note id', body: 'x' }, { id: 'n1abc', title: 'good note', body: 'hello' }],
};

function poke(jot) {   // hover everything in the task list and note cards, then click every checkbox and note card
    const { w, doc } = jot;
    doc.querySelectorAll('#todoList, #todoList *, .note-item, .note-item *').forEach(el => el.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true })));
    doc.querySelectorAll('.note-item').forEach(el => el.click());
    const n = doc.querySelectorAll('#todoList .todo-check').length;
    for (let i = 0; i < n; i++) { const c = doc.querySelectorAll('#todoList .todo-check')[i]; if (c) c.click(); }
}

function checkAll(tag, jot) {
    const d = jot.data(), byText = s => d.todos.find(t => t.text === s);
    const safe = id => typeof id === 'string' && /^[a-z0-9]+$/.test(id);
    check(`${tag}: bad task ID replaced`, safe(byText('bad id').id), byText('bad id').id);
    check(`${tag}: bad priority replaced with none`, byText('bad priority').priority === 'none', byText('bad priority').priority);
    check(`${tag}: bad repeat replaced with none`, byText('bad repeat').repeat === 'none', byText('bad repeat').repeat);
    check(`${tag}: bad due time cleared`, byText('bad time').dueTime === null, byText('bad time').dueTime);
    check(`${tag}: bad note ID replaced`, safe(d.notes.find(n => n.title === 'bad note id').id));
    const g = byText('good');
    check(`${tag}: valid task kept as is`, g.id === 'ok1aa' && g.priority === 'high' && g.repeat === 'weekly' && g.dueTime === '09:30' && g.dueDate === '2030-01-15', JSON.stringify(g));
    check(`${tag}: valid note ID kept`, d.notes.some(n => n.id === 'n1abc'));
    check(`${tag}: no injected markup in the task list`, !jot.doc.querySelector('#inj-repeat, #inj-time, #todoList [onmouseover]'));
    const row = [...jot.doc.querySelectorAll('#todoList .todo-item')].find(r => r.textContent.includes('bad id'));
    if (row) row.querySelector('.todo-check').click();
    check(`${tag}: task with a replaced ID can still be checked off`, jot.data().todos.find(t => t.text === 'bad id').completed === true);
    poke(jot);
    check(`${tag}: no payload ran`, !jot.w.__ran, `ran ${jot.w.__ran} time(s)`);
    check(`${tag}: no script errors`, jot.errors.length === 0, jot.errors.slice(0, 3).join(' | '));
}

(async () => {
    const page = process.argv[2];
    const jot = open(page, { seed: { todos: [], notes: [], groups: [], sections: {}, settings: { theme: 'purple' } } });
    await restore(jot, crafted);
    checkAll('restore', jot);
    const saved = JSON.parse(jot.w.localStorage.getItem('quicknotes_data'));
    check('restore: cleaned values are what got saved', !JSON.stringify(saved).includes('__ran'));

    checkAll('startup', open(page, { rawSeed: JSON.stringify(crafted) }));
    done();
})().catch(e => { console.log('CRASH', e && e.stack); finish(2); });
