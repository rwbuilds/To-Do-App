// Two copies of Jot's page, each with its own storage, syncing through one shared (in-memory)
// folder the way the main process gives it to them. Covers turning sync on from Settings, adds,
// deletes, the open note, typing in a task editor, a conflict with its banner and review dialog,
// the before-merge backup, the status line and stopping.
'use strict';
const { open, checker } = require('./helpers');
const { check, done } = checker('sync between two computers');

const folder = new Map();   // file name -> text: the shared cloud folder
function fakeMain(deviceId, deviceName, log) {
    const own = `jot-${deviceId}.json`;
    const st = { on: false };
    const status = () => ({ enabled: st.on, dir: st.on ? '/Users/me/OneDrive/Jot Sync' : null, available: st.on, deviceId, deviceName, error: null });
    return () => ({
        getSync: async () => status(),
        listSyncDrives: async () => [{ id: 0, name: 'OneDrive', path: '/Users/me/OneDrive' }, { id: 1, name: 'iCloud Drive', path: '/Users/me/iCloud' }],
        useSyncDrive: async (i) => { log.drive = i; st.on = true; return status(); },
        chooseSyncFolder: async () => status(),
        stopSync: async () => { st.on = false; return status(); },
        syncWrite: async (text) => { folder.set(own, text); log.writes++; return { ok: true }; },
        syncWriteBeforeQuit: (text) => { folder.set(own, text); return { ok: true }; },
        syncRead: async () => ({ files: [...folder].filter(([n]) => n !== own).map(([name, text]) => ({ name, text })) }),
        syncBackup: (text) => { log.backups.push(text); },
        onSyncChanged: () => {},
    });
}
const logA = { writes: 0, backups: [] }, logB = { writes: 0, backups: [] };
const A = open(process.argv[2], {
    seed: { todos: [{ id: 'ma1aa', text: 'mac task', createdAt: '2026-11-01T00:00:00.000Z' }],
        notes: [{ id: 'nn1aa', title: 'Plan', body: 'first', bodyHtml: 'first', updatedAt: '2026-11-01T00:00:00.000Z', tags: [], folder: '' }],
        groups: [], sections: {}, settings: { theme: 'purple' } },
    api: fakeMain('aaaaaaaaaaaaaaaa', 'Mac (studio)', logA),
});
const B = open(process.argv[2], {
    seed: { todos: [{ id: 'wb1aa', text: 'windows task', createdAt: '2026-11-01T00:00:00.000Z' }], notes: [], groups: [], sections: {}, settings: { theme: 'mint' } },
    api: fakeMain('bbbbbbbbbbbbbbbb', 'Windows (desk)', logB),
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const texts = jot => jot.w.eval('data.todos.map(t => t.text)').slice().sort().join(' | ');
const idle = jot => { const a = jot.doc.activeElement; if (a && a.blur) a.blur(); };

(async () => {
    await sleep(30);
    check('off by default: status says Off', A.doc.getElementById('syncStatusText').textContent.startsWith('Off.'));
    A.w.openSettings();
    await sleep(30);
    const opts = [...A.doc.querySelectorAll('#syncDriveSelect option')].map(o => o.textContent);
    check('the drive list shows each cloud drive plus Other folder', JSON.stringify(opts) === '["OneDrive","iCloud Drive","Other folder…"]', JSON.stringify(opts));
    A.doc.getElementById('syncDriveSelect').value = '1';
    A.doc.getElementById('syncStartBtn').click();
    await sleep(60);
    check('picking a drive sends only its number', logA.drive === 1);
    check('starting writes this computer\'s file', folder.has('jot-aaaaaaaaaaaaaaaa.json'));
    check('the on controls show', A.doc.getElementById('syncOnControls').style.display !== 'none' && A.doc.getElementById('syncOffControls').style.display === 'none');

    B.w.openSettings(); await sleep(20);
    B.doc.getElementById('syncDriveSelect').value = '0';
    B.doc.getElementById('syncStartBtn').click();
    await sleep(80);
    check('the second computer gets the first one\'s tasks and keeps its own', texts(B) === 'mac task | windows task', texts(B));
    check('and the note', B.w.eval('data.notes.length') === 1);
    check('settings stay per computer', B.w.eval('data.settings.theme') === 'mint' && A.w.eval('data.settings.theme') === 'purple');
    check('a merge that changed something saved a backup first', logB.backups.length === 1 && JSON.parse(logB.backups[0]).todos.length === 1);
    check('the status line names the other computer', /synced just now with Mac \(studio\)/.test(B.doc.getElementById('syncStatusText').textContent), B.doc.getElementById('syncStatusText').textContent);

    await A.w.runSync(); await sleep(20);
    check('and back the other way', texts(A) === 'mac task | windows task', texts(A));

    // An add on one, through the real add path
    A.w.eval("data.todos.unshift({ id: 'ma2aa', text: 'added on mac', completed: false, wip: false, archived: false, tags: [], subtasks: [], group: '', section: '', repeat: 'none', dueDate: null, dueTime: null, createdAt: new Date().toISOString() }); saveData();");
    check('a change waits 5 seconds before writing', A.w.eval('!!syncWriteTimer'));
    await A.w.syncNow(); await sleep(10);
    await B.w.runSync(); await sleep(10);
    check('an add reaches the other computer', texts(B).includes('added on mac'));

    // A delete on the other
    B.w.eval("data.todos = data.todos.filter(t => t.id !== 'ma1aa'); saveData();");
    await B.w.syncNow(); await sleep(10);
    await A.w.runSync(); await sleep(10);
    check('a delete reaches the other computer', !texts(A).includes('mac task'), texts(A));
    check('and stays deleted after another round', (await A.w.syncNow(), await B.w.runSync(), !texts(B).includes('mac task')));

    // Typing in a task editor holds the merge off
    B.w.eval("data.todos.unshift({ id: 'wb2aa', text: 'second windows task', createdAt: new Date().toISOString(), tags: [], subtasks: [] }); saveData();");
    await B.w.syncNow();
    const input = A.doc.createElement('input'); A.doc.getElementById('app').appendChild(input); input.focus();
    await A.w.runSync(); await sleep(10);
    check('no merge while typing in a field', !texts(A).includes('second windows task'));
    input.remove(); idle(A);
    await A.w.runSync(); await sleep(10);
    check('it merges once typing stops', texts(A).includes('second windows task'));

    // The open note is left alone until closed
    A.w.openNoteEditor('nn1aa');
    await sleep(5);
    B.w.eval("data.notes[0].body = 'edited on windows'; data.notes[0].bodyHtml = 'edited on windows'; saveData();");
    await B.w.syncNow();
    await A.w.runSync(); await sleep(10);
    check('the open note is not changed under the cursor', A.w.eval('data.notes[0].body') === 'first');
    A.w.closeNoteEditor(); await sleep(40);
    check('closing it merges it', A.w.eval('data.notes[0].body') === 'edited on windows');

    // Both edit the same note: newer wins, the conflict is flagged on the computer that merges it
    A.w.eval("data.notes[0].body = 'mac version'; data.notes[0].bodyHtml = 'mac version'; saveData();");
    await A.w.syncNow();
    await sleep(5);
    B.w.eval("data.notes[0].body = 'windows version'; data.notes[0].bodyHtml = 'windows version'; saveData();");
    idle(B);
    await B.w.runSync(); await sleep(20);
    check('both edited: the newer version is kept', B.w.eval('data.notes[0].body') === 'windows version');
    check('the conflict banner shows', B.doc.getElementById('syncConflictBanner').classList.contains('show'));
    check('the banner says what happened', /made on both computers\. The newer version was kept/.test(B.doc.getElementById('syncConflictText').textContent));
    check('Settings offers a review button', B.doc.getElementById('syncReviewBtn').style.display !== 'none' && B.doc.getElementById('syncReviewBtn').textContent === 'Review 1 conflict');
    B.w.openSyncConflicts();
    const box = B.doc.getElementById('syncConflictList').textContent;
    check('the review names both computers and both versions', box.includes('Windows (desk)') && box.includes('Mac (studio)') && box.includes('mac version'), box);
    check('focus goes into the dialog', B.doc.activeElement === B.doc.getElementById('syncConflictsClose'));
    const useOther = [...B.doc.querySelectorAll('#syncConflictList button')].find(b => b.textContent === 'Use the other version');
    check('a note conflict offers Keep both too', [...B.doc.querySelectorAll('#syncConflictList button')].some(b => b.textContent === 'Keep both'));
    useOther.click();
    check('Use the other version puts it back', B.w.eval('data.notes[0].body') === 'mac version');
    check('and the conflict is gone', B.w.eval('data._sync.conflicts.length') === 0 && !B.doc.getElementById('syncConflictBanner').classList.contains('show'));
    B.doc.dispatchEvent(new B.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('Esc closes the review', !B.doc.getElementById('syncConflictsModal').classList.contains('active'));
    await B.w.syncNow(); idle(A);
    await A.w.runSync(); await sleep(10);
    check('the choice syncs back without a new conflict', A.w.eval('data.notes[0].body') === 'mac version' && A.w.eval('data._sync.conflicts.length') === 0);

    // Keep both
    A.w.eval("data.notes[0].body = 'mac two'; saveData();"); await A.w.syncNow(); await sleep(5);
    B.w.eval("data.notes[0].body = 'win two'; saveData();"); idle(B); await B.w.runSync(); await sleep(10);
    B.w.openSyncConflicts();
    [...B.doc.querySelectorAll('#syncConflictList button')].find(b => b.textContent === 'Keep both').click();
    const titles = B.w.eval('data.notes.map(n => n.title + ":" + n.body)');
    check('Keep both adds the other version as its own note', titles.length === 2 && titles.some(t => t === 'Plan (from Mac (studio)):mac two') && titles.some(t => t === 'Plan:win two'), JSON.stringify(titles));
    B.w.closeSyncConflicts();

    // Restore on one computer doesn't delete things on the other
    const countBefore = B.w.eval('data.todos.length');
    A.w.eval("replaceAllData(migrateData({ todos: [{ id: 'rs1aa', text: 'from an old backup' }] })); saveData();");
    await A.w.syncNow(); idle(B); await B.w.runSync(); await sleep(10);
    check('a restore on one computer deletes nothing on the other', B.w.eval('data.todos.length') === countBefore + 1, String(B.w.eval('data.todos.length')));

    // Quitting writes straight away
    A.w.eval("data.todos.unshift({ id: 'qq1aa', text: 'just before quit', createdAt: new Date().toISOString() }); saveData();");
    A.w.dispatchEvent(new A.w.Event('beforeunload'));
    check('quitting writes the file without the 5-second wait', folder.get('jot-aaaaaaaaaaaaaaaa.json').includes('just before quit'));

    // A newer Jot's file is skipped with a message
    folder.set('jot-cccccccccccccccc.json', JSON.stringify({ _app: 'Jot', format: 2, appVersion: '1.9.0', deviceId: 'cccccccccccccccc', data: {} }));
    await A.w.runSync(); await sleep(10);
    check('a newer Jot is named in the status line', /newer Jot \(1\.9\.0\)/.test(A.doc.getElementById('syncStatusText').textContent), A.doc.getElementById('syncStatusText').textContent);
    folder.delete('jot-cccccccccccccccc.json');

    await A.w.stopSync(); await sleep(10);
    check('Stop syncing turns it off', A.doc.getElementById('syncStatusText').textContent.startsWith('Off.') && A.doc.getElementById('syncOffControls').style.display !== 'none');
    check('no page errors', A.errors.length === 0 && B.errors.length === 0, JSON.stringify(A.errors.concat(B.errors)));
    done();
})().catch(e => { check('ran', false, String(e && e.stack || e)); done(); });
