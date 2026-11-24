// Loads the real main.js with Electron stubbed out and checks its link handler, reminders and
// daily backups. Everything it writes goes to a temporary folder, never Jot's real data.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { checker, finish } = require('./helpers');
const { check, done } = checker('main process');

const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'jot-test-userdata-'));
process.on('exit', () => { try { fs.rmSync(UD, { recursive: true, force: true }); } catch (e) {} });
// Fake home with the folders the cloud drive apps make, on both platforms
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jot-test-home-'));
process.on('exit', () => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch (e) {} });
for (const p of ['Library/Mobile Documents/com~apple~CloudDocs', 'Library/CloudStorage/OneDrive-Personal',
    'Library/CloudStorage/GoogleDrive-me@example.com/My Drive', 'Library/CloudStorage/Dropbox', 'OneDriveWin']) {
    fs.mkdirSync(path.join(HOME, p), { recursive: true });
}
process.env.OneDriveConsumer = path.join(HOME, 'OneDriveWin');
delete process.env.OneDriveCommercial; delete process.env.OneDrive;
const fakeOs = Object.assign({}, os, { homedir: () => HOME });

const ipcOn = {}, ipcHandle = {}, opened = [], notifications = [];
let dialogResult = { canceled: true, filePaths: [] };
const noop = () => {};
const fakeWin = {
    on: noop, once: noop, loadFile: noop, setAlwaysOnTop: noop, setVisibleOnAllWorkspaces: noop, setPosition: noop,
    setBounds: noop, setMinimumSize: noop, setResizable: noop, getPosition: () => [0, 0], getSize: () => [440, 700],
    getBounds: () => ({ x: 0, y: 0, width: 440, height: 700 }), hide: noop, show: noop, focus: noop, minimize: noop,
    isVisible: () => true, isDestroyed: () => false, showInactive: noop, setIgnoreMouseEvents: noop, close: noop,
    webContents: { on: noop, send: noop, session: {} },
};
class FakeNotification {
    constructor(opts) { this.opts = opts; notifications.push(this); }
    on() {} show() { this.shown = true; }
}
const electron = {
    app: {
        quit: noop, on: noop, whenReady: () => new Promise(() => {}), getPath: () => UD,
        getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings: noop,
        requestSingleInstanceLock: () => true, setAppUserModelId: noop, isPackaged: false, dock: null,
    },
    BrowserWindow: function () { return fakeWin; },
    Tray: function () { return { setToolTip: noop, setContextMenu: noop, on: noop }; },
    Menu: Object.assign(function () { return { append: noop, popup: noop }; }, { buildFromTemplate: () => ({ append: noop, popup: noop }) }),
    MenuItem: function () {},
    ipcMain: { on: (ch, cb) => { ipcOn[ch] = cb; }, handle: (ch, cb) => { ipcHandle[ch] = cb; } },
    dialog: { showOpenDialog: async () => dialogResult },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }), createEmpty: () => ({}) },
    screen: {
        getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
        getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
        getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    },
    globalShortcut: { register: noop, unregisterAll: noop },
    Notification: FakeNotification,
    shell: { openExternal: u => opened.push(u), openPath: noop },
    autoUpdater: { on: noop, checkForUpdates: noop, quitAndInstall: noop },
};
const realLoad = Module._load;
Module._load = function (request) {   // main.js also requires 'electron' lazily inside handlers, so keep this in place
    if (request === 'electron') return electron;
    if (request === 'os') return fakeOs;   // a fake home folder, so the cloud drive list never sees the real one
    if (request === 'electron-squirrel-startup') return false;
    if (request === 'update-electron-app') return { updateElectronApp: noop };
    return realLoad.apply(this, arguments);
};
require(path.join(__dirname, '..', process.argv[3] || 'main.js'));

// Links: web and email links open, everything else is refused
const tries = {
    'https://example.com/a?b=1': 'https://example.com/a?b=1',
    'http://example.com': 'http://example.com/',
    'mailto:someone@example.com': 'mailto:someone@example.com',
    'https://example.com/my page': 'https://example.com/my%20page',
};
for (const [url, want] of Object.entries(tries)) {
    opened.length = 0;
    ipcOn['open-external'](null, url);
    check(`opens ${url}`, opened.length === 1 && opened[0] === want, JSON.stringify(opened));
}
for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.com', 'slack://open', 'not a url', '', null, 42,
                   'https://example.com\njavascript:alert(1)']) {
    opened.length = 0;
    ipcOn['open-external'](null, url);
    check(`refuses ${JSON.stringify(url)}`, opened.every(u => /^https?:\/\/[^\s]*$/.test(u)) && (opened.length === 0 || /^https?:/.test(String(url))), JSON.stringify(opened));
}

// Reminders fire for due times with one- or two-digit hours, and not for future tasks
const pad = n => String(n).padStart(2, '0');
const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
ipcOn['set-reminders'](null, true);
ipcOn['sync-reminders'](null, [
    { id: 'one-digit', text: 'one-digit hour', dueDate: day(-1), dueTime: '9:00', completed: false },
    { id: 'two-digit', text: 'two-digit hour', dueDate: day(-1), dueTime: '09:00', completed: false },
    { id: 'seconds', text: 'with seconds', dueDate: day(-1), dueTime: '09:00:00', completed: false },
    { id: 'no-time', text: 'no time', dueDate: day(-1), completed: false },
    { id: 'future', text: 'future', dueDate: day(2), dueTime: '9:00', completed: false },
    { id: 'done', text: 'completed', dueDate: day(-1), completed: true },
]);
const fired = notifications.filter(n => n.shown).map(n => n.opts.body);
for (const name of ['one-digit hour', 'two-digit hour', 'with seconds', 'no time']) check(`reminder fires: ${name}`, fired.includes(name), JSON.stringify(fired));
check('no reminder for a future task', !fired.includes('future'));
check('no reminder for a completed task', !fired.includes('completed'));
ipcOn['set-reminders'](null, false);

// Daily backups: one file per day, and an invalid payload is never written
const backups = () => { const d = path.join(UD, 'backups'); return fs.existsSync(d) ? fs.readdirSync(d) : []; };
ipcOn['auto-backup'](null, 'not json');
check('an invalid backup is not written', backups().length === 0, JSON.stringify(backups()));
ipcOn['auto-backup'](null, JSON.stringify({ todos: [], notes: [] }));
ipcOn['auto-backup'](null, JSON.stringify({ todos: [{ id: 'x' }], notes: [] }));
check('one backup a day, named by the local date', backups().length === 1 && backups()[0] === `jot-autobackup-${day(0)}.json`, JSON.stringify(backups()));

// Cloud backup folder: off by default, set only through the folder picker, and each folder keeps
// its own once-a-day check and its own 7-file prune.
(async () => {
    if (!ipcHandle['get-cloud-backup']) { check('cloud backup handlers exist', false); return done(); }
    const CLOUD = fs.mkdtempSync(path.join(os.tmpdir(), 'jot-test-cloud-'));
    process.on('exit', () => { try { fs.rmSync(CLOUD, { recursive: true, force: true }); } catch (e) {} });
    const cloudFiles = () => fs.readdirSync(CLOUD).sort();
    const tag = require('os').hostname().split('.')[0].replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'computer';
    const payload = JSON.stringify({ todos: [{ id: 'c1' }], notes: [] });

    let st = await ipcHandle['get-cloud-backup']();
    check('cloud backup is off by default', st.dir === null && st.available === false, JSON.stringify(st));

    st = await ipcHandle['choose-cloud-backup-folder']();
    check('cancelling the picker leaves it off', st.dir === null, JSON.stringify(st));

    dialogResult = { canceled: false, filePaths: [CLOUD] };
    st = await ipcHandle['choose-cloud-backup-folder']();
    check('picking a folder turns it on', st.dir === CLOUD && st.available === true, JSON.stringify(st));
    check('the folder is saved in jot-settings.json', JSON.parse(fs.readFileSync(path.join(UD, 'jot-settings.json'), 'utf8')).cloudBackupDir === CLOUD);

    // Today's local backup already exists, but the cloud copy is still written (separate check per folder)
    ipcOn['auto-backup'](null, payload);
    const want = `jot-autobackup-${tag}-${day(0)}.json`;
    check('cloud copy is written even when the local one already exists', cloudFiles().includes(want), JSON.stringify(cloudFiles()));
    check('cloud copy holds the payload', fs.readFileSync(path.join(CLOUD, want), 'utf8') === payload);
    check('the local folder still has one backup', backups().length === 1, JSON.stringify(backups()));
    ipcOn['auto-backup'](null, JSON.stringify({ todos: [], notes: [] }));
    check('cloud copy is written once a day', fs.readFileSync(path.join(CLOUD, want), 'utf8') === payload);
    ipcOn['auto-backup'](null, 'not json');
    check('an invalid payload never reaches the cloud folder', cloudFiles().length === 1, JSON.stringify(cloudFiles()));

    // Prune keeps this machine's newest 7 and never touches the other machine's files or anything else
    fs.unlinkSync(path.join(CLOUD, want));
    for (let i = 1; i <= 9; i++) fs.writeFileSync(path.join(CLOUD, `jot-autobackup-${tag}-${day(-i)}.json`), '{}');
    for (let i = 1; i <= 9; i++) fs.writeFileSync(path.join(CLOUD, `jot-autobackup-OtherPC-${day(-i)}.json`), '{}');
    fs.writeFileSync(path.join(CLOUD, 'notes.txt'), 'keep me');
    ipcOn['auto-backup'](null, payload);
    const mine = cloudFiles().filter(f => f.startsWith(`jot-autobackup-${tag}-`));
    check('cloud prune keeps this computer\'s newest 7', mine.length === 7 && mine.includes(want) && !mine.includes(`jot-autobackup-${tag}-${day(-9)}.json`), JSON.stringify(mine));
    check('cloud prune leaves the other computer\'s backups alone', cloudFiles().filter(f => f.includes('-OtherPC-')).length === 9);
    check('cloud prune leaves other files alone', cloudFiles().includes('notes.txt'));

    // Drive offline: skipped, reported, and no folder is created at that path
    const gone = path.join(CLOUD, 'missing-drive');
    dialogResult = { canceled: false, filePaths: [gone] };
    await ipcHandle['choose-cloud-backup-folder']();
    ipcOn['auto-backup'](null, payload);
    st = await ipcHandle['get-cloud-backup']();
    check('a missing folder is reported, not created', st.available === false && !!st.error && !fs.existsSync(gone), JSON.stringify(st));

    st = await ipcHandle['clear-cloud-backup-folder']();
    check('turning it off clears the folder and the error', st.dir === null && st.error === null, JSON.stringify(st));

    // ----- Sync between computers -----
    if (!ipcHandle['get-sync']) { check('sync handlers exist', false); return done(); }
    let s = await ipcHandle['get-sync']();
    check('sync is off by default', s.enabled === false && s.dir === null, JSON.stringify(s));
    check('this computer gets a 16-hex sync ID', /^[a-f0-9]{16}$/.test(s.deviceId), s.deviceId);
    check('the ID is kept', (await ipcHandle['get-sync']()).deviceId === s.deviceId && JSON.parse(fs.readFileSync(path.join(UD, 'jot-settings.json'), 'utf8')).syncDeviceId === s.deviceId);
    check('the name says which kind of computer', /^(Mac|Windows|Linux)( \(.+\))?$/.test(s.deviceName), s.deviceName);
    const me = s.deviceId;

    const drives = await ipcHandle['list-sync-drives']();
    const names = drives.map(d => d.name);
    if (process.platform === 'darwin') {
        check('Mac: finds iCloud Drive, OneDrive, Google Drive and Dropbox', ['iCloud Drive', 'OneDrive (Personal)', 'Google Drive (me@example.com)', 'Dropbox'].every(n => names.includes(n)), JSON.stringify(names));
        check('Mac: Google Drive points at My Drive', drives.find(d => d.name.startsWith('Google')).path.endsWith(path.join('GoogleDrive-me@example.com', 'My Drive')));
    } else if (process.platform === 'win32') {
        check('Windows: finds OneDrive from its environment variable', names.includes('OneDrive (personal)'), JSON.stringify(names));
    }
    check('every drive listed exists', drives.every(d => fs.existsSync(d.path)) && drives.every((d, i) => d.id === i));

    s = await ipcHandle['use-sync-drive'](null, 999);
    check('a drive number that isn\'t in the list does nothing', s.enabled === false);
    s = await ipcHandle['use-sync-drive'](null, '0');
    check('only a whole number picks a drive', s.enabled === false);
    s = await ipcHandle['use-sync-drive'](null, 0);
    const SYNC = path.join(drives[0].path, 'Jot Sync');
    check('picking a drive makes a Jot Sync folder there', s.enabled === true && s.dir === SYNC && fs.existsSync(SYNC), JSON.stringify(s));
    check('the folder is kept per computer in jot-settings.json', JSON.parse(fs.readFileSync(path.join(UD, 'jot-settings.json'), 'utf8')).syncDir === SYNC);

    const good = JSON.stringify({ _app: 'Jot', format: 1, deviceId: me, data: { todos: [{ id: 'aa1', text: 'x' }] } });
    check('writing refuses text that isn\'t JSON', !!(ipcHandle['sync-write'](null, 'nope')).error);
    check('writing refuses JSON that isn\'t Jot\'s', !!(ipcHandle['sync-write'](null, '{"a":1}')).error);
    check('writing refuses something that isn\'t text', !!(ipcHandle['sync-write'](null, { _app: 'Jot' })).error);
    check('a good write succeeds', ipcHandle['sync-write'](null, good).ok === true);
    const ownFile = path.join(SYNC, `jot-${me}.json`);
    check('it writes jot-<this computer>.json', fs.readFileSync(ownFile, 'utf8') === good);
    check('no temp file is left', !fs.readdirSync(SYNC).some(f => f.endsWith('.tmp')));
    const ev = {};
    ipcOn['sync-write-before-quit'](ev, good.replace('"x"', '"y"'));
    check('the quit write is synchronous and answers', ev.returnValue && ev.returnValue.ok === true && fs.readFileSync(ownFile, 'utf8').includes('"y"'));

    const other = JSON.stringify({ _app: 'Jot', format: 1, deviceId: 'bbbbbbbbbbbbbbbb', data: {} });
    fs.writeFileSync(path.join(SYNC, 'jot-bbbbbbbbbbbbbbbb.json'), other);
    fs.writeFileSync(path.join(SYNC, 'notes.txt'), 'not mine');
    fs.writeFileSync(path.join(SYNC, 'jot-short.json'), '{}');
    fs.writeFileSync(path.join(SYNC, 'jot-cccccccccccccccc.json.tmp'), '{}');
    fs.mkdirSync(path.join(SYNC, 'jot-dddddddddddddddd.json'));
    let r = await ipcHandle['sync-read']();
    check('reading returns only the other computers\' files', r.files && r.files.length === 1 && r.files[0].name === 'jot-bbbbbbbbbbbbbbbb.json' && r.files[0].text === other, JSON.stringify(r).slice(0, 200));

    for (let i = 0; i < 12; i++) ipcOn['sync-backup'](null, JSON.stringify({ todos: [], n: i }));
    ipcOn['sync-backup'](null, 'not json');
    const bk = fs.readdirSync(path.join(UD, 'backups')).filter(f => f.startsWith('jot-before-sync-'));
    check('a before-merge backup is kept, the last 10', bk.length === 10, String(bk.length));
    check('the daily backups are left alone', fs.readdirSync(path.join(UD, 'backups')).some(f => /^jot-autobackup-\d/.test(f)));

    dialogResult = { canceled: false, filePaths: [path.join(HOME, 'OneDriveWin')] };
    s = await ipcHandle['choose-sync-folder']();
    check('Other folder uses the picked folder as is', s.enabled === true && s.dir === path.join(HOME, 'OneDriveWin'));
    dialogResult = { canceled: true, filePaths: [] };
    s = await ipcHandle['choose-sync-folder']();
    check('cancelling the picker keeps the folder', s.dir === path.join(HOME, 'OneDriveWin'));

    // Drive offline: errors say so, and nothing is created at that path
    const unplugged = path.join(HOME, "Unplugged");
    dialogResult = { canceled: false, filePaths: [unplugged] };
    await ipcHandle["choose-sync-folder"]();
    r = await ipcHandle['sync-read']();
    check('reading a missing folder reports it', /not found/.test(r.error || ''), JSON.stringify(r));
    check('writing to a missing folder reports it and creates nothing', /not found/.test(ipcHandle["sync-write"](null, good).error || "") && !fs.existsSync(unplugged));
    check('the status says so too', /not found/.test((await ipcHandle['get-sync']()).error || ''));

    s = await ipcHandle['stop-sync']();
    check('Stop syncing turns it off', s.enabled === false && s.dir === null);
    check('reading while off does nothing', !!(await ipcHandle['sync-read']()).error);
    done();
})().catch(e => { check('cloud backup checks ran', false, String(e && e.stack || e)); done(); });
