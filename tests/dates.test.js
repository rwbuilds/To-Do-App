// Date parsing in the task box, with the clock fixed, plus due-time padding when data loads.
'use strict';
const { open, checker } = require('./helpers');
const { check, done } = checker('dates');

const j = open(process.argv[2], { seed: { todos: [], notes: [], groups: [], sections: {} } });
const w = j.w, RealDate = w.Date;
function at(y, m, d) {   // make the page's "now" a given local day at 10:00
    const fixed = new RealDate(y, m - 1, d, 10, 0, 0).getTime();
    w.Date = class extends RealDate {
        constructor(...a) { if (a.length) super(...a); else super(fixed); }
        static now() { return fixed; }
    };
}
const P = s => w.parseNaturalSchedule(s);

// "next <weekday>" = that day in next week (Monday to Sunday)
const cases = [
    ['Mon 26 Oct', [2026, 10, 26], 'friday', '2026-10-30'], ['Mon 26 Oct', [2026, 10, 26], 'next friday', '2026-11-06'],
    ['Wed 28 Oct', [2026, 10, 28], 'next friday', '2026-11-06'], ['Wed 28 Oct', [2026, 10, 28], 'next monday', '2026-11-02'],
    ['Fri 23 Oct', [2026, 10, 23], 'friday', '2026-10-30'], ['Fri 23 Oct', [2026, 10, 23], 'next friday', '2026-10-30'],
    ['Sat 24 Oct', [2026, 10, 24], 'next friday', '2026-10-30'], ['Sun 25 Oct', [2026, 10, 25], 'next friday', '2026-10-30'],
    ['Sun 25 Oct', [2026, 10, 25], 'next sunday', '2026-11-01'], ['Thu 31 Dec', [2026, 12, 31], 'next tue', '2027-01-05'],
];
for (const [label, ymd, text, want] of cases) {
    at(...ymd);
    const r = P('call bob ' + text);
    check(`${label}: "${text}" -> ${want}`, r.dueDate === want && r.text === 'call bob', JSON.stringify(r));
}

// Days a month doesn't have stay in the text, with no date
at(2026, 10, 23);
for (const text of ['feb 30', 'sep 31', 'apr 31', '31 june']) {
    const r = P('pay rent ' + text);
    check(`"${text}" sets no date and stays in the text`, r.dueDate === null && r.text === 'pay rent ' + text, JSON.stringify(r));
}
check('"jan 31" is next 31 January', P('x jan 31').dueDate === '2027-01-31', P('x jan 31').dueDate);
check('"oct 23" on 23 Oct is today', P('x oct 23').dueDate === '2026-10-23', P('x oct 23').dueDate);
check('"feb 29" goes to the next leap year', P('x feb 29').dueDate === '2028-02-29', P('x feb 29').dueDate);
check('"28 feb" still works', P('x 28 feb').dueDate === '2027-02-28', P('x 28 feb').dueDate);

// 12-hour times need an hour from 1 to 12
check('"13pm" sets no time and stays in the text', P('meet 13pm').dueTime === null && P('meet 13pm').text === 'meet 13pm', JSON.stringify(P('meet 13pm')));
check('"0am" sets no time', P('meet 0am').dueTime === null, JSON.stringify(P('meet 0am')));
check('"5pm" is 17:00', P('meet 5pm').dueTime === '17:00');
check('"12am" is 00:00 and "12pm" is 12:00', P('a 12am').dueTime === '00:00' && P('a 12pm').dueTime === '12:00');
check('"9:30am" is 09:30', P('a 9:30am').dueTime === '09:30');
check('"17:45" still works', P('a 17:45').dueTime === '17:45');
w.Date = RealDate;

// Due times are stored as HH:MM when data loads, so main.js can read them
const m = w.migrateData({ todos: [
    { id: 'aa1', text: 'a', dueDate: '2030-01-15', dueTime: '9:00' },
    { id: 'aa2', text: 'b', dueDate: '2030-01-15', dueTime: '09:30:00' },
    { id: 'aa3', text: 'c', dueDate: '2030-01-15', dueTime: '25:00' },
    { id: 'aa4', text: 'd', dueDate: '2030-01-15', dueTime: '17:05' },
] });
const times = m.todos.map(t => t.dueTime);
check('"9:00" becomes 09:00, "09:30:00" becomes 09:30, "25:00" is cleared, "17:05" kept',
    JSON.stringify(times) === JSON.stringify(['09:00', '09:30', null, '17:05']), JSON.stringify(times));
// main-process.test.js checks that main.js fires reminders for these times
check('no script errors', j.errors.length === 0, j.errors.slice(0, 2).join(' | '));
done();
