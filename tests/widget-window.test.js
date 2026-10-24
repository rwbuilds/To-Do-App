// The widget's quick-add box: main.js widens the 56x56 widget window to 340x56, growing leftward
// near the screen's right edge, and shrinks it back to the same spot. Loads the real main.js with
// Electron stubbed out and a fake window that keeps its bounds. Writes only to a temporary folder.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { checker } = require('./helpers');
const { check, done } = checker('widget window sizes');

const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'jot-test-userdata-'));
process.on('exit', () => { try { fs.rmSync(UD, { recursive: true, force: true }); } catch (e) {} });

const noop = () => {};
const loose = obj => new Proxy(obj, { get: (t, k) => (k in t ? t[k] : (k === 'then' ? undefined : noop)) });
const bounds = { x: 0, y: 0, width: 56, height: 56 };
const win = loose({
    getPosition: () => [bounds.x, bounds.y],
    getSize: () => [bounds.width, bounds.height],
    getBounds: () => ({ ...bounds }),
    setBounds: b => { Object.assign(bounds, b); },
    setPosition: (x, y) => { bounds.x = x; bounds.y = y; },
    setSize: (w, h) => { bounds.width = w; bounds.height = h; },
    isVisible: () => true, isDestroyed: () => false, isMinimized: () => false, isFocused: () => true,
    webContents: loose({ session: loose({}) }),
});
const ipcOn = {}, appOn = {};
const electron = {
    app: {
        quit: noop, on: (ev, cb) => { appOn[ev] = cb; }, whenReady: () => new Promise(() => {}), getPath: () => UD,
        getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings: noop,
        requestSingleInstanceLock: () => true, setAppUserModelId: noop, isPackaged: false, dock: null,
    },
    BrowserWindow: Object.assign(function () { return win; }, { getAllWindows: () => [win] }),
    Tray: function () { return loose({}); },
    Menu: Object.assign(function () { return loose({}); }, { buildFromTemplate: () => loose({}) }),
    MenuItem: function () {},
    ipcMain: { on: (ch, cb) => { ipcOn[ch] = cb; }, handle: noop },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }), createEmpty: () => ({}) },
    screen: {
        getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
        getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
        getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    },
    globalShortcut: { register: noop, unregisterAll: noop },
    Notification: function () { return loose({}); },
    shell: { openExternal: noop, openPath: noop },
    autoUpdater: loose({}),
};
const realLoad = Module._load;
Module._load = function (request) {
    if (request === 'electron') return electron;
    if (request === 'electron-squirrel-startup') return false;
    if (request === 'update-electron-app') return { updateElectronApp: noop };
    return realLoad.apply(this, arguments);
};
require(path.join(__dirname, '..', process.argv[3] || 'main.js'));
appOn['second-instance']();   // showWindow() creates the window
const resize = state => ipcOn['resize-window'](null, state);
const at = b => `${b.x},${b.y} ${b.width}x${b.height}`;
const place = (x, y) => Object.assign(bounds, { x, y, width: 56, height: 56 });   // as if the widget was dragged there

place(100, 60);
resize('quick-add');
check('quick add widens the widget to 340x56 in place', at(bounds) === '100,60 340x56', at(bounds));
resize('quick-add');
check('asking twice changes nothing', at(bounds) === '100,60 340x56', at(bounds));
resize('widget');
check('closing it shrinks the widget back to the same spot', at(bounds) === '100,60 56x56', at(bounds));

place(1850, 60);
resize('quick-add');
check('near the right edge it grows leftward and stays on screen', at(bounds) === '1566,60 340x56', at(bounds));
resize('widget');
check('and shrinks back to the widget\'s spot', at(bounds) === '1850,60 56x56', at(bounds));

place(700, 300);
resize('expanded');
const expanded = at(bounds);
resize('quick-add');
check('quick add does nothing while Jot is expanded', at(bounds) === expanded, `${expanded} -> ${at(bounds)}`);
resize('widget');
check('collapsing still returns the widget to where it was', at(bounds) === '700,300 56x56', at(bounds));
done();
