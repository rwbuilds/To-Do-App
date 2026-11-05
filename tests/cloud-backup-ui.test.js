// Settings > Data > Cloud backup folder: shows Off until a folder is picked, then the path with
// Open / Turn off, a clear message when the drive is offline, and writes a backup right after
// a folder is picked. The main process is faked through window.widgetAPI.
'use strict';
const { open, checker } = require('./helpers');
const { check, done } = checker('cloud backup settings');

const seed = { todos: [{ id: 'a1aaa', text: 'one' }], notes: [], groups: [], sections: {}, settings: { theme: 'purple' } };
const j = open(process.argv[2], { seed });
const { w, doc } = j;

const sent = [];
let status = { dir: null, available: false, error: null };
let pick = null;   // what the folder picker returns
Object.assign(w.widgetAPI || (w.widgetAPI = {}), {
    autoBackup: s => sent.push(s),
    getCloudBackup: async () => status,
    chooseCloudBackupFolder: async () => { if (pick) status = { dir: pick, available: true, error: null }; return status; },
    clearCloudBackupFolder: async () => { status = { dir: null, available: false, error: null }; return status; },
    openCloudBackupFolder: () => sent.push('open'),
});

const text = () => (doc.getElementById('cloudBackupText') || {}).textContent || '';
const shown = id => { const el = doc.getElementById(id); return !!el && el.style.display !== 'none'; };
const tick = () => new Promise(r => setTimeout(r, 20));

(async () => {
    check('the row exists', !!doc.getElementById('cloudBackupText'));
    w.openSettings();
    await tick();
    check('off by default', text().startsWith('Off.'), text());
    check('only Choose shows when off', shown('cloudBackupChooseBtn') && !shown('cloudBackupOpenBtn') && !shown('cloudBackupOffBtn'));

    // Cancelled picker: nothing changes and no backup is sent
    await w.chooseCloudBackupFolder();
    await tick();
    check('cancelling leaves it off', text().startsWith('Off.') && sent.length === 0, text());

    pick = '/Users/me/OneDrive/Jot';
    await w.chooseCloudBackupFolder();
    await tick();
    check('picking a folder shows its path', text() === pick, text());
    check('Open and Turn off show once a folder is set', shown('cloudBackupOpenBtn') && shown('cloudBackupOffBtn'));
    check('Choose becomes Change', doc.getElementById('cloudBackupChooseBtn').textContent === 'Change');
    const backup = sent.find(s => s !== 'open');
    check('a backup is sent right after picking', !!backup && JSON.parse(backup)._auto === true && JSON.parse(backup).todos.length === 1, String(backup).slice(0, 80));

    doc.getElementById('cloudBackupOpenBtn').click();
    check('Open asks the main process to open the folder', sent.includes('open'));

    status = { dir: pick, available: false, error: null };
    await w.refreshCloudBackup();
    check('an offline drive is explained', text().includes('Folder not found'), text());
    check('Open hides while the folder is missing', !shown('cloudBackupOpenBtn') && shown('cloudBackupOffBtn'));

    status = { dir: pick, available: true, error: 'Could not write to the folder.' };
    await w.refreshCloudBackup();
    check('a write error is shown', text().includes('Could not write'), text());

    await w.clearCloudBackupFolder();
    await tick();
    check('Turn off goes back to Off', text().startsWith('Off.') && !shown('cloudBackupOffBtn'), text());
    check('no page errors', j.errors.length === 0, JSON.stringify(j.errors));
    done();
})().catch(e => { check('ran', false, String(e && e.stack || e)); done(); });
