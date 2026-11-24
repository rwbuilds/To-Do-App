// Sync: change tracking in saveData, and the merge (mergeSync) run on hand-made data. Covers adds,
// edits and deletes on each side, both computers editing one item, delete-vs-edit, Undo after a
// delete, an empty or cut-off file, a file with bad values, a newer file format, the open note,
// order, and groups/sections/folders.
'use strict';
const { open, checker } = require('./helpers');
const { check, done } = checker('sync merge');

const j = open(process.argv[2], { seed: {
    todos: [{ id: 't1aaa', text: 'one', createdAt: '2026-01-01T00:00:00.000Z' }, { id: 't2aaa', text: 'two', createdAt: '2026-01-01T00:00:00.000Z' }],
    notes: [{ id: 'n1aaa', title: 'Note', body: 'hi', updatedAt: '2026-01-01T00:00:00.000Z' }],
    groups: ['Work'], sections: { Work: ['Today'] }, settings: { theme: 'purple' },
} });
const { w } = j;
const ev = s => w.eval(s);
const T = m => new Date(Date.UTC(2026, 10, 24, 10, m)).toISOString();
const NOW = T(59);
const mk = o => w.migrateData(JSON.parse(JSON.stringify(o)));
const MAC = 'aaaaaaaaaaaaaaaa', WIN = 'bbbbbbbbbbbbbbbb';
const merge = (l, r, extra = {}) => w.mergeSync(l, r, { localId: MAC, localName: 'Mac', remoteId: WIN, remoteName: 'Windows', now: NOW, ...extra });
const ids = d => d.todos.map(t => t.id).join(',');
const task = (id, text, m, extra = {}) => ({ id, text, createdAt: T(0), updatedAt: T(m), ...extra });

// ----- Change tracking -----
check('old tasks without updatedAt load fine', ev('data.todos.length') === 2 && ev('data.todos[0].updatedAt') === undefined);
ev("data.todos[0].text = 'one edited'; saveData();");
check('an edit stamps updatedAt', !!ev('data.todos[0].updatedAt'));
check('an untouched task is not stamped', ev('data.todos[1].updatedAt') === undefined);
const stamp = ev('data.todos[0].updatedAt');
ev('saveData();');
check('saving again without a change keeps the stamp', ev('data.todos[0].updatedAt') === stamp);
ev("data.todos.reverse(); saveData();");
check('reordering records orderAt', !!ev('data._sync.orderAt.todos'));
ev("var gone = data.todos.splice(0, 1)[0]; saveData();");
check('a delete is recorded with its time', !!ev(`data._sync.deleted.todos[gone.id]`));
ev("data.todos.unshift(gone); saveData();");
check('Undo clears the deletion', ev('data._sync.deleted.todos[gone.id]') === undefined);
check('and the restored task is newer than its deletion', !!ev('data.todos[0].updatedAt'));
ev("deleteGroup('Work');");
check('deleting a group records the group and its section', !!ev("data._sync.deleted.groups.Work") && !!ev("data._sync.deleted.sections['Work\\u001fToday']"));
ev("data.groups.push('Home'); saveData();");
check('adding a group records when', !!ev("data._sync.addedAt.groups.Home"));
// Restore isn't an edit: nothing missing from the backup is recorded as deleted
const before = Object.keys(ev('data._sync.deleted.todos')).length;
ev(`replaceAllData(migrateData({ todos: [{ id: 'zz1aa', text: 'from backup' }] })); saveData();`);
check('a restore records no deletions', Object.keys(ev('data._sync.deleted.todos')).length === before);
check('a restore keeps the restored task as it was', ev('data.todos[0].updatedAt') === undefined);
// A note edit through the editor's own save path is tracked too
ev("data.notes = [{ id: 'n9aaa', title: 'T', body: 'x', updatedAt: '2026-01-01T00:00:00.000Z', tags: [], folder: '' }]; resetTracking(); data.notes[0].body = 'y'; saveData();");
check('a note edit stamps the note', ev('data.notes[0].updatedAt') !== '2026-01-01T00:00:00.000Z');

// ----- Merge: adds, edits, deletes -----
let L = mk({ todos: [task('a1aaa', 'mine', 1)] });
let R = mk({ todos: [task('b1aaa', 'theirs', 2)] });
let out = merge(L, R);
check('adds on each side are both kept', ids(out.data) === 'b1aaa,a1aaa', ids(out.data));
check('the other side\'s new task goes on top', out.data.todos[0].id === 'b1aaa');
check('merge reports a change', out.changed === true);
check('merge changes neither input', L.todos.length === 1 && R.todos.length === 1);

L = mk({ todos: [task('a1aaa', 'old', 1)] });
R = mk({ todos: [task('a1aaa', 'new', 5)] });
out = merge(L, R);
check('a newer edit from the other side wins', out.data.todos[0].text === 'new');
check('first sync of a task edited on both: no conflict (only notes flag then)', out.conflicts.length === 0);
out = merge(R, L);
check('an older edit from the other side loses', out.data.todos[0].text === 'new' && out.changed === false);

L = mk({ todos: [task('a1aaa', 'kept', 1)] });
R = mk({ todos: [], _sync: { deleted: { todos: { a1aaa: T(3) } } } });
out = merge(L, R);
check('a deletion newer than the last edit removes it', out.data.todos.length === 0);
check('and the deletion is recorded here', !!out.data._sync.deleted.todos.a1aaa);
L = mk({ todos: [task('a1aaa', 'edited later', 4)] });
out = merge(L, R);
check('an edit newer than the deletion keeps it', out.data.todos.length === 1);

L = mk({ todos: [task('a1aaa', 'x', 1)], _sync: { deleted: { todos: { b1aaa: T(6) } } } });
R = mk({ todos: [task('b1aaa', 'deleted here', 2)] });
out = merge(L, R);
check('a task deleted here isn\'t brought back by an older copy', ids(out.data) === 'a1aaa');
R = mk({ todos: [task('b1aaa', 'edited there after', 7)] });
out = merge(L, R);
check('but comes back if it was changed there after the delete', ids(out.data).includes('b1aaa'));

// Missing is never deleted
L = mk({ todos: [task('a1aaa', 'x', 1), task('a2aaa', 'y', 1)], notes: [{ id: 'n1aaa', title: 'n', body: 'b', updatedAt: T(1) }], groups: ['Work'] });
out = merge(L, mk({}));
check('an empty file removes nothing', out.data.todos.length === 2 && out.data.notes.length === 1 && out.data.groups.includes('Work'));
const cut = w.parseSyncFile('{"_app":"Jot","format":1,"deviceId":"bbbbbbbbbbbbbbbb","data":{"todos":[{"id":"a1a');
check('a cut-off file is not read', cut.ok === false);
check('a file from a newer Jot is skipped', w.parseSyncFile(JSON.stringify({ _app: 'Jot', format: 99, appVersion: '2.0.0', deviceId: WIN, data: {} })).reason === 'newer');
check('a file without a device ID is skipped', w.parseSyncFile(JSON.stringify({ _app: 'Jot', format: 1, data: {} })).ok === false);

// A hostile file gets the same checks as a restore
const bad = w.parseSyncFile(JSON.stringify({ _app: 'Jot', format: 1, deviceId: WIN, data: {
    todos: [{ id: "x');alert(1)//", text: 'a', priority: '"><img src=x onerror=alert(1)>', repeat: '<b>', dueTime: '25:99', updatedAt: 'not a time' }],
    groups: ['__proto__', 'ok', 5], sections: { __proto__: ['x'], ok: ['s', { a: 1 }] }, noteFolders: ['constructor', 'f'],
    _sync: { deleted: { todos: { "bad id!": T(1), good1: 'never' } }, orderAt: { todos: 'soon' } },
} }));
check('bad file: parsed', bad.ok === true);
const bt = bad.ok && bad.data.todos[0];
check('bad file: the ID is replaced', bt && /^[A-Za-z0-9_-]+$/.test(bt.id));
check('bad file: priority, repeat and time are cleaned', bt && bt.priority === 'none' && bt.repeat === 'none' && bt.dueTime === null);
check('bad file: a bad updatedAt is dropped', bt && bt.updatedAt === undefined);
check('bad file: names that reach Object.prototype are dropped', bad.ok && JSON.stringify(bad.data.groups) === '["ok"]' && JSON.stringify(bad.data.noteFolders) === '["f"]' && JSON.stringify(bad.data.sections) === '{"ok":["s"]}');
check('bad file: bad deletion entries are dropped', bad.ok && JSON.stringify(bad.data._sync.deleted.todos) === '{}' && bad.data._sync.orderAt.todos === null);
out = merge(mk({}), bad.data);
check('merging it adds no prototype keys', !Object.prototype.hasOwnProperty.call(w.Object.prototype, 'x') && ({}).x === undefined && out.data.groups.length === 1);

// ----- Conflicts -----
// Sync once so each side knows the other's version, then edit on both
const n0 = { id: 'n1aaa', title: 'Plan', body: 'v0', updatedAt: T(1) };
L = mk({ notes: [n0] });
R = mk({ notes: [n0] });
let first = merge(L, R);
check('identical notes: no conflict', first.conflicts.length === 0 && first.data._sync.seen[WIN].notes.n1aaa === T(1));
L = first.data;
L.notes[0].body = 'mac edit'; L.notes[0].updatedAt = T(10);
R = mk({ notes: [{ ...n0, body: 'windows edit', updatedAt: T(12) }] });
out = merge(L, R);
check('both edited a note: the newer one wins', out.data.notes[0].body === 'windows edit');
check('and the conflict is flagged', out.conflicts.length === 1 && out.data._sync.conflicts.length === 1);
const c = out.data._sync.conflicts[0];
check('the flag keeps the other version and who made each', c && c.other.body === 'mac edit' && c.kept === 'Windows' && c.otherFrom === 'Mac' && c.deleted === false);
check('a conflict counts as a change', out.changed === true);

// Only one side changed since the last sync: no conflict
L = first.data; L.notes[0].body = v0copy(); L.notes[0].updatedAt = T(1);
function v0copy() { return 'v0'; }
R = mk({ notes: [{ ...n0, body: 'windows only', updatedAt: T(12) }] });
out = merge(L, R);
check('changed on one side only: taken without a conflict', out.data.notes[0].body === 'windows only' && out.conflicts.length === 0);

// First sync with differing notes: flagged (no base to tell who changed)
out = merge(mk({ notes: [{ ...n0, body: 'a', updatedAt: T(3) }] }), mk({ notes: [{ ...n0, body: 'b', updatedAt: T(4) }] }));
check('first sync with two different notes: flagged', out.conflicts.length === 1 && out.data.notes[0].body === 'b');

// Tasks after a first sync: flagged when both changed
const t0 = task('a1aaa', 'buy milk', 1);
let base = merge(mk({ todos: [t0] }), mk({ todos: [t0] })).data;
base.todos[0].text = 'buy oat milk'; base.todos[0].updatedAt = T(20);
out = merge(base, mk({ todos: [{ ...t0, text: 'buy milk and eggs', updatedAt: T(21) }] }));
check('both edited a task since the last sync: flagged, newer wins', out.conflicts.length === 1 && out.data.todos[0].text === 'buy milk and eggs');

// Deleted there after being changed here: removed, and flagged so it can be restored
base = merge(mk({ todos: [t0] }), mk({ todos: [t0] })).data;
base.todos[0].text = 'changed here'; base.todos[0].updatedAt = T(20);
out = merge(base, mk({ todos: [], _sync: { deleted: { todos: { a1aaa: T(25) } } } }));
check('deleted there after an edit here: removed', out.data.todos.length === 0);
check('and flagged with the lost version', out.conflicts.length === 1 && out.conflicts[0].deleted === true && out.conflicts[0].other.text === 'changed here');

// Tie: same time on both sides. Each computer must pick the same winner.
const tieL = mk({ todos: [task('a1aaa', 'mac', 5)] }), tieR = mk({ todos: [task('a1aaa', 'win', 5)] });
const onMac = merge(tieL, tieR).data.todos[0].text;
const onWin = w.mergeSync(tieR, tieL, { localId: WIN, localName: 'Windows', remoteId: MAC, remoteName: 'Mac', now: NOW }).data.todos[0].text;
check('a tie is broken the same way on both computers', onMac === onWin, onMac + ' / ' + onWin);

// The open note is left alone
L = mk({ notes: [{ ...n0, body: 'typing', updatedAt: T(1) }] });
out = merge(L, mk({ notes: [{ ...n0, body: 'newer there', updatedAt: T(30) }] }), { lockedNoteId: 'n1aaa' });
check('the note open in the editor is not changed', out.data.notes[0].body === 'typing' && out.conflicts.length === 0);
check('and it isn\'t marked as seen, so it merges once closed', !out.data._sync.seen[WIN].notes.n1aaa);

// ----- Order -----
L = mk({ todos: [task('a1aaa', '1', 1), task('a2aaa', '2', 1), task('a3aaa', '3', 1)], _sync: { orderAt: { todos: T(1) } } });
R = mk({ todos: [task('a3aaa', '3', 1), task('a1aaa', '1', 1), task('a2aaa', '2', 1)], _sync: { orderAt: { todos: T(9) } } });
check('the order from whoever reordered last wins', ids(merge(L, R).data) === 'a3aaa,a1aaa,a2aaa');
check('an older reorder there doesn\'t move things here', ids(merge(R, L).data) === 'a3aaa,a1aaa,a2aaa' && merge(R, L).changed === false);

// ----- Groups, sections, folders -----
L = mk({ groups: ['Work', 'Home'], sections: { Work: ['Today'] }, noteFolders: ['Ideas'], _sync: { addedAt: { groups: { Home: T(1) } } } });
R = mk({ groups: ['Work', 'Errands'], sections: { Work: ['Today', 'Later'] }, noteFolders: [], _sync: { deleted: { groups: { Home: T(5) } } } });
out = merge(L, R);
check('a group deleted there after it was added here goes', !out.data.groups.includes('Home'));
check('a group added there comes in', out.data.groups.includes('Errands'));
check('sections merge by name', JSON.stringify(out.data.sections.Work) === '["Today","Later"]');
check('a folder missing there stays (missing is not deleted)', out.data.noteFolders.includes('Ideas'));
// A task in a group the other computer deleted keeps its group
L = mk({ groups: ['Work'], sections: { Work: ['Today'] }, todos: [task('a1aaa', 'x', 30, { group: 'Work', section: 'Today' })], _sync: { addedAt: { groups: { Work: T(1) } } } });
R = mk({ groups: [], sections: {}, _sync: { deleted: { groups: { Work: T(10) }, sections: { 'Work\u001fToday': T(10) } } } });
out = merge(L, R);
check('a group still used by a task is put back', out.data.groups.includes('Work') && (out.data.sections.Work || []).includes('Today'));

// ----- Deletions are forgotten after 90 days -----
L = mk({ _sync: { deleted: { todos: { old11: '2026-01-01T00:00:00.000Z', new11: T(1) } } } });
out = merge(L, mk({}));
check('deletions older than 90 days are dropped', !out.data._sync.deleted.todos.old11 && !!out.data._sync.deleted.todos.new11);

check('no page errors', j.errors.length === 0, JSON.stringify(j.errors));
done();
