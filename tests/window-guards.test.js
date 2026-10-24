// main.js keeps the window on Jot's page: navigations and new windows are refused, web and email
// links open outside Jot, and permissions Jot never needs are refused while the clipboard keeps
// working. Loads the real main.js with Electron stubbed out; writes only to a temporary folder.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { checker } = require('./helpers');
const { check, done } = checker('window guards');

const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'jot-test-userdata-'));
process.on('exit', () => { try { fs.rmSync(UD, { recursive: true, force: true }); } catch (e) {} });

const noop = () => {};
const loose = obj => new Proxy(obj, { get: (t, k) => (k in t ? t[k] : (k === 'then' ? undefined : noop)) });
const OWN = 'file:///Applications/Jot.app/Contents/Resources/app.asar/index.html';
const wcOn = {}, opened = [];
let openHandler = null, permHandler = null;
const win = loose({
    getPosition: () => [0, 0], getSize: () => [56, 56], getBounds: () => ({ x: 0, y: 0, width: 56, height: 56 }),
    isVisible: () => true, isDestroyed: () => false,
    webContents: loose({
        on: (ev, cb) => { wcOn[ev] = cb; },
        setWindowOpenHandler: fn => { openHandler = fn; },
        getURL: () => OWN,
        session: loose({ setPermissionRequestHandler: fn => { permHandler = fn; } }),
    }),
});
const appOn = {}, ipcOn = {};
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
    shell: { openExternal: u => opened.push(u), openPath: noop },
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

function navigate(url, legacy) {   // Electron 25+ passes the URL on the event; older versions as a second argument
    opened.length = 0;
    let prevented = false;
    const event = { preventDefault: () => { prevented = true; } };
    if (!legacy) event.url = url;
    if (wcOn['will-navigate']) wcOn['will-navigate'](event, legacy ? url : undefined);
    return { prevented, opened: [...opened] };
}
let r = navigate('https://example.com/page');
check('navigating to a web page is refused', r.prevented);
check('and the page opens in the browser instead', r.opened.join() === 'https://example.com/page', JSON.stringify(r.opened));
r = navigate('file:///Users/me/Documents/dropped.pdf');
check('a dropped file does not replace Jot', r.prevented && r.opened.length === 0, JSON.stringify(r));
r = navigate('javascript:alert(1)', true);
check('the older event form is refused too', r.prevented && r.opened.length === 0, JSON.stringify(r));
r = navigate(OWN + '#top');
check('Jot reloading its own page is allowed', !!wcOn['will-navigate'] && !r.prevented);

const openWin = url => { opened.length = 0; const res = openHandler ? openHandler({ url }) : { action: 'allow' }; return { res, opened: [...opened] }; };
let o = openWin('https://example.com/x');
check('new windows are refused', o.res.action === 'deny');
check('a web link that asks for a new window opens in the browser', o.opened.join() === 'https://example.com/x', JSON.stringify(o.opened));
o = openWin('mailto:someone@example.com');
check('an email link opens in the mail app', o.res.action === 'deny' && o.opened.join() === 'mailto:someone@example.com');
for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'slack://open']) {
    o = openWin(url);
    check(`${url} is refused and not opened`, o.res.action === 'deny' && o.opened.length === 0, JSON.stringify(o));
}

const ask = permission => { let got = null; if (permHandler) permHandler(null, permission, v => { got = v; }); return got; };
for (const p of ['media', 'geolocation', 'display-capture', 'usb', 'openExternal']) check(`permission ${p} is refused`, ask(p) === false, String(ask(p)));
for (const p of ['clipboard-sanitized-write', 'clipboard-read', 'notifications']) check(`permission ${p} is still allowed`, ask(p) === true, String(ask(p)));
done();
