// Finishing a repeating task schedules the next copy on the first date in its series that comes
// after today, so a task finished late doesn't come back already overdue. Today is fixed to
// Friday 23 October 2026.
'use strict';
const { open, checker } = require('./helpers');
const { check, done } = checker('repeats');

const cases = [
    // [what, repeat, old due date, expected next due date]
    ['daily, 3 days late', 'daily', '2026-10-20', '2026-10-24'],
    ['daily, due today', 'daily', '2026-10-23', '2026-10-24'],
    ['daily, finished early', 'daily', '2026-10-25', '2026-10-26'],
    ['daily, no due date', 'daily', null, '2026-10-24'],
    ['weekly, 11 days late', 'weekly', '2026-10-12', '2026-10-26'],
    ['weekly, a week late (today is in the series)', 'weekly', '2026-10-16', '2026-10-30'],
    ['weekly, due today', 'weekly', '2026-10-23', '2026-10-30'],
    ['monthly, late from the 31st', 'monthly', '2026-08-31', '2026-10-31'],
    ['monthly, a month late', 'monthly', '2026-09-15', '2026-11-15'],
    ['monthly, due today', 'monthly', '2026-10-23', '2026-11-23'],
    ['monthly, Jan 31 finished early', 'monthly', '2027-01-31', '2027-02-28'],
];

const todos = cases.map(([what, repeat, due], i) => ({
    id: 'r' + i + 'aaa', text: 'task ' + i, repeat, dueDate: due, dueTime: i === 0 ? '08:15' : null,
    group: 'Home', section: 'Chores', priority: 'high', tags: ['home'],
    subtasks: [{ text: 'step', done: true }],
}));
const j = open(process.argv[2], { seed: { todos, notes: [], groups: ['Home'], sections: { Home: ['Chores'] }, settings: { theme: 'purple' } } });
const w = j.w, RealDate = w.Date;
const fixed = new RealDate(2026, 9, 23, 10, 0, 0).getTime();
w.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(fixed); }
    static now() { return fixed; }
};

cases.forEach(([what, , , want], i) => {
    w.toggleTodo('r' + i + 'aaa');
    const copies = j.data().todos.filter(t => t.text === 'task ' + i && !t.completed);
    check(`${what}: next copy due ${want}`, copies.length === 1 && copies[0].dueDate === want, JSON.stringify(copies.map(t => t.dueDate)));
});

const next = j.data().todos.find(t => t.text === 'task 0' && !t.completed);
check('the copy keeps group, section, priority, tags and due time',
    next.group === 'Home' && next.section === 'Chores' && next.priority === 'high' && next.tags.join() === 'home' && next.dueTime === '08:15',
    JSON.stringify(next));
check('the copy\'s subtasks start unticked', next.subtasks.length === 1 && next.subtasks[0].done === false);
check('the finished task stays completed', j.data().todos.find(t => t.id === 'r0aaa').completed === true);

// Un-completing and completing again must not make a second copy
w.toggleTodo('r0aaa');
w.toggleTodo('r0aaa');
check('completing the same task twice makes one copy', j.data().todos.filter(t => t.text === 'task 0' && !t.completed).length === 1);
w.Date = RealDate;
check('no script errors', j.errors.length === 0, j.errors.slice(0, 2).join(' | '));
done();
