// Restoring a backup must drop a picked section that the restored groups don't have, and keep one they do.
'use strict';
const { open, restore, checker, finish } = require('./helpers');
const { check, done } = checker('restore');

const seed = {
    groups: ['Work', 'Home'], sections: { Work: ['Reports', 'Email'], Home: ['Chores'] },
    todos: [{ id: 'abc12', text: 'existing', group: 'Work', section: 'Reports' }], notes: [], settings: { theme: 'purple' },
};

function helpers(jot) {
    const { w, doc } = jot;
    const el = id => doc.getElementById(id);
    const change = (id, v) => { el(id).value = v; el(id).dispatchEvent(new w.Event('change')); };
    return {
        pick(group, section) { change('groupSelect', group); change('sectionSelect', section); },
        options: () => [...el('sectionSelect').options].map(o => o.value),
        chips: () => el('addChips') ? [...doc.querySelectorAll('#addChips [data-for]')].map(c => c.value) : null,
        add(text) { el('todoInput').value = text; w.addTodo(); return jot.data().todos.find(t => t.text === text); },
    };
}

(async () => {
    const page = process.argv[2];

    // A: the backup has no Work group
    let jot = open(page, { seed }), h = helpers(jot);
    h.pick('Work', 'Reports');
    await restore(jot, { groups: ['Home'], sections: { Home: ['Chores'] }, todos: [], notes: [] });
    check('A: group resets to No Group', jot.doc.getElementById('groupSelect').value === '');
    check('A: section resets to No Section', jot.doc.getElementById('sectionSelect').value === '', jot.doc.getElementById('sectionSelect').value);
    check('A: section list no longer offers Work\'s sections', !h.options().includes('Reports'), h.options().join(','));
    const chipsA = h.chips();
    check('A: no Reports chip above the task box', chipsA === null || !chipsA.includes('Reports'), chipsA && chipsA.join(','));
    let t = h.add('after restore A');
    check('A: next task has no section', t && t.section === '' && t.group === '', t && JSON.stringify([t.group, t.section]));
    t = h.add('after restore A2');
    check('A: second task has no section', t && t.section === '', t && t.section);

    // B: the backup still has Work and Reports, so the pick stays valid
    jot = open(page, { seed }); h = helpers(jot);
    h.pick('Work', 'Reports');
    await restore(jot, seed);
    check('B: group stays Work', jot.doc.getElementById('groupSelect').value === 'Work');
    check('B: section stays Reports', jot.doc.getElementById('sectionSelect').value === 'Reports', jot.doc.getElementById('sectionSelect').value);
    t = h.add('after restore B');
    check('B: next task goes to Work > Reports', t && t.group === 'Work' && t.section === 'Reports', t && JSON.stringify([t.group, t.section]));

    // C: the backup has Work, but not its Reports section
    jot = open(page, { seed }); h = helpers(jot);
    h.pick('Work', 'Reports');
    await restore(jot, { groups: ['Work'], sections: { Work: ['Email'] }, todos: [], notes: [] });
    check('C: group stays Work', jot.doc.getElementById('groupSelect').value === 'Work');
    check('C: section resets to No Section', jot.doc.getElementById('sectionSelect').value === '', jot.doc.getElementById('sectionSelect').value);
    check('C: section list shows the restored Work sections', h.options().join(',') === ',Email', h.options().join(','));
    t = h.add('after restore C');
    check('C: next task goes to Work with no section', t && t.group === 'Work' && t.section === '', t && JSON.stringify([t.group, t.section]));

    // D: Work's tab is open (group picker on No Group) and the backup has no Work group
    jot = open(page, { seed }); h = helpers(jot);
    jot.w.selectGroupTab('Work');
    h.pick('', 'Reports');
    check('D: setup picked Reports from the Work tab', jot.doc.getElementById('sectionSelect').value === 'Reports');
    await restore(jot, { groups: ['Home'], sections: { Home: ['Chores'] }, todos: [], notes: [] });
    check('D: tab falls back to All', jot.doc.getElementById('groupFilter').value === 'all', jot.doc.getElementById('groupFilter').value);
    check('D: section resets to No Section', jot.doc.getElementById('sectionSelect').value === '', jot.doc.getElementById('sectionSelect').value);
    t = h.add('after restore D');
    check('D: next task has no group or section', t && t.group === '' && t.section === '', t && JSON.stringify([t.group, t.section]));

    check('no script errors', jot.errors.length === 0, jot.errors.slice(0, 3).join(' | '));
    done();
})().catch(e => { console.log('CRASH', e && e.stack); finish(2); });
