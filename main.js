const { app, BrowserWindow, Tray, Menu, MenuItem, ipcMain, nativeImage, screen, globalShortcut, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

// Prevent a stray error from showing the Electron crash dialog / killing the app
process.on('uncaughtException', (err) => { console.error('Uncaught:', err); });

// Handle Squirrel install/uninstall events (creates Start Menu + desktop shortcuts).
// Without this, the installer runs but no shortcuts are created.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let alwaysOnTop = true;
let isExpanded = false;   // explicit expanded/widget state for reliable blur handling
let isEditingNote = false; // renderer tells us when a note editor is open
let suppressCollapse = false; // set briefly during file dialogs / link opens
let snapSuppressUntil = 0;    // ignore snap evaluation briefly after programmatic resizes

// ===== DUE REMINDERS =====
let remindersEnabled = false;
let reminderTasks = [];          // [{ id, text, dueDate, completed }]
const notifiedTaskIds = new Set();
let reminderTimer = null;

function checkReminders() {
  if (!remindersEnabled) return;
  const now = new Date();
  // Only notify from 9 AM onward on the due day (or immediately if overdue)
  reminderTasks.forEach(t => {
    if (!t.dueDate || t.completed) return;
    if (notifiedTaskIds.has(t.id)) return;
    const due = new Date(t.dueDate + 'T09:00:00');
    if (now >= due) {
      notifiedTaskIds.add(t.id);
      try {
        const n = new Notification({
          title: 'Jot — Task due',
          body: t.text,
          silent: false,
        });
        n.on('click', () => { showWindow(); if (mainWindow) mainWindow.webContents.send('focus-task', t.id); });
        n.show();
      } catch (e) { /* notifications unsupported */ }
    }
  });
}

function startReminderTimer() {
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = setInterval(checkReminders, 60 * 1000); // every minute
  checkReminders(); // run once now
}

// ===== SETTINGS PERSISTENCE =====
// Stored in the OS user-data folder so it survives reinstalls.
const settingsPath = () => path.join(app.getPath('userData'), 'jot-settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveSettings(patch) {
  const cur = loadSettings();
  const next = { ...cur, ...patch };
  try { fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2)); } catch (e) {}
}

// ===== AUTO-LAUNCH ON STARTUP =====
// Uses Electron's built-in login item settings (writes the Windows
// registry Run key automatically). '--hidden' tells our app to start
// minimized to the tray when launched at boot.
function isAutoLaunchEnabled() {
  return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
}

function setAutoLaunch(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,       // macOS hint; harmless on Windows
    args: ['--hidden'],       // passed to the app on auto-start
  });
}

// True when the app was launched by Windows at startup
function launchedAtStartup() {
  return process.argv.includes('--hidden') ||
    app.getLoginItemSettings().wasOpenedAtLogin;
}

// Window sizes for the two states
const WIDGET_SIZE = { width: 56, height: 56 };
const EXPANDED_SIZE = { width: 440, height: 700 };
const MIN_EXPANDED = { width: 320, height: 400 };

// Remembers where the widget sat so we can restore it on collapse
let widgetAnchor = null;

function createWindow() {
  const settings = loadSettings();

  mainWindow = new BrowserWindow({
    width: WIDGET_SIZE.width,
    height: WIDGET_SIZE.height,
    frame: false,              // no OS title bar — we draw our own
    transparent: true,         // allows the rounded/transparent widget
    resizable: false,          // toggled on when expanded
    alwaysOnTop: true,         // real always-on-top
    skipTaskbar: false,
    hasShadow: false,          // no OS shadow — we style our own
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  // Keep it above fullscreen apps too
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.loadFile('index.html');

  // Ensure the spell checker has a language loaded so it returns suggestions.
  // Without an explicit language, words get flagged but dictionarySuggestions is empty.
  try {
    const ses = mainWindow.webContents.session;
    const available = ses.availableSpellCheckerLanguages || [];
    const prefer = ['en-US', 'en-GB', 'en'].filter(l => available.includes(l));
    if (prefer.length) {
      ses.setSpellCheckerLanguages(prefer);
    } else if (available.length) {
      ses.setSpellCheckerLanguages([available[0]]);
    }
    ses.setSpellCheckerEnabled(true);
  } catch (e) { /* older Electron / unsupported platform */ }

  // Right-click context menu for editable areas: spelling suggestions + edit actions
  mainWindow.webContents.on('context-menu', (event, params) => {
    // Only show our menu in editable fields (note body, inputs) or on misspelled words
    if (!params.isEditable && !params.misspelledWord) return;

    const menu = new Menu();

    // Spelling suggestions first (most prominent) when a misspelled word is right-clicked
    if (params.misspelledWord) {
      if (params.dictionarySuggestions.length > 0) {
        for (const suggestion of params.dictionarySuggestions) {
          menu.append(new MenuItem({
            label: suggestion,
            click: () => mainWindow.webContents.replaceMisspelling(suggestion),
          }));
        }
      } else {
        menu.append(new MenuItem({ label: 'No spelling suggestions', enabled: false }));
      }
      menu.append(new MenuItem({
        label: 'Add to dictionary',
        click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // Standard edit actions
    menu.append(new MenuItem({ label: 'Cut', role: 'cut', enabled: params.editFlags.canCut }));
    menu.append(new MenuItem({ label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy }));
    menu.append(new MenuItem({ label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste }));
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));

    menu.popup();
  });

  // Restore saved widget position, or default to top-right
  if (settings.widgetX != null && settings.widgetY != null) {
    widgetAnchor = { x: settings.widgetX, y: settings.widgetY };
    mainWindow.setPosition(settings.widgetX, settings.widgetY);
  } else {
    const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
    mainWindow.setPosition(sw - WIDGET_SIZE.width - 40, 60);
  }

  // Remember the user's custom expanded size if they resized before
  if (settings.expandedW && settings.expandedH) {
    EXPANDED_SIZE.width = Math.max(MIN_EXPANDED.width, settings.expandedW);
    EXPANDED_SIZE.height = Math.max(MIN_EXPANDED.height, settings.expandedH);
  }

  // Persist expanded size when the user resizes (debounced)
  let resizeSaveTimer = null;
  mainWindow.on('resize', () => {
    if (mainWindow.isResizable()) {
      const [w, h] = mainWindow.getSize();
      EXPANDED_SIZE.width = w;
      EXPANDED_SIZE.height = h;
      if (resizeSaveTimer) clearTimeout(resizeSaveTimer);
      resizeSaveTimer = setTimeout(() => { saveSettings({ expandedW: w, expandedH: h }); }, 400);
    }
  });

  // If launched by Windows at startup, stay hidden in the tray
  if (launchedAtStartup()) {
    mainWindow.hide();
  }

  // Clicking away (losing focus) collapses the expanded app back to the widget.
  // Do the collapse in the main process directly so it doesn't depend on
  // an IPC round-trip; also notify the renderer to swap its UI to widget mode.
  mainWindow.on('blur', () => {
    if (!mainWindow || !isExpanded) return;
    if (isEditingNote || suppressCollapse) return;
    collapseToWidgetFromMain();
  });

  // ===== CUSTOM SNAP-TO-EDGE (expanded mode) =====
  // Snap is evaluated only when the drag actually ends (renderer sends 'window-drop'),
  // so changing your mind mid-drag never forces an unwanted snap.
  let snapping = false;

  function evaluateSnap() {
    if (!mainWindow || !isExpanded || snapping) return;
    if (Date.now() < snapSuppressUntil) return;
    const pt = screen.getCursorScreenPoint();
    const disp = screen.getDisplayNearestPoint(pt);
    const wa = disp.workArea;
    const T = 24; // px from edge that counts as "in the snap zone"
    const nearLeft = pt.x <= wa.x + T;
    const nearRight = pt.x >= wa.x + wa.width - T;
    const nearTop = pt.y <= wa.y + T;
    const nearBottom = pt.y >= wa.y + wa.height - T;
    const halfW = Math.floor(wa.width / 2);
    const halfH = Math.floor(wa.height / 2);

    let b = null;
    if (nearTop && nearLeft)       b = { x: wa.x,          y: wa.y,          width: halfW,           height: halfH };
    else if (nearTop && nearRight) b = { x: wa.x + halfW,  y: wa.y,          width: wa.width - halfW, height: halfH };
    else if (nearBottom && nearLeft)  b = { x: wa.x,        y: wa.y + halfH,  width: halfW,           height: wa.height - halfH };
    else if (nearBottom && nearRight) b = { x: wa.x + halfW, y: wa.y + halfH, width: wa.width - halfW, height: wa.height - halfH };
    else if (nearLeft)             b = { x: wa.x,          y: wa.y,          width: halfW,           height: wa.height };
    else if (nearRight)            b = { x: wa.x + halfW,  y: wa.y,          width: wa.width - halfW, height: wa.height };
    else if (nearTop)              b = { x: wa.x,          y: wa.y,          width: wa.width,        height: wa.height };

    if (b) {
      tweenBounds(b, () => {
        EXPANDED_SIZE.width = b.width;
        EXPANDED_SIZE.height = b.height;
        saveSettings({ expandedW: b.width, expandedH: b.height });
      });
    }
  }

  // Smoothly animate the window to target bounds (~140ms ease-out)
  function tweenBounds(target, done) {
    if (!mainWindow) return;
    snapping = true;
    const start = mainWindow.getBounds();
    const steps = 10;
    let i = 0;
    const ease = t => 1 - Math.pow(1 - t, 3); // ease-out cubic
    const iv = setInterval(() => {
      i++;
      const t = ease(i / steps);
      if (!mainWindow) { clearInterval(iv); return; }
      const nb = {
        x: Math.round(start.x + (target.x - start.x) * t),
        y: Math.round(start.y + (target.y - start.y) * t),
        width: Math.round(start.width + (target.width - start.width) * t),
        height: Math.round(start.height + (target.height - start.height) * t),
      };
      if ([nb.x, nb.y, nb.width, nb.height].every(v => isFinite(v)) && nb.width > 0 && nb.height > 0) {
        try { mainWindow.setBounds(nb); } catch (e) {}
      }
      if (i >= steps) {
        clearInterval(iv);
        try { mainWindow.setBounds(target); } catch (e) {}
        setTimeout(() => { snapping = false; }, 60);
        if (done) done();
      }
    }, 14);
  }

  // Renderer tells us the titlebar drag ended → evaluate snap once
  mainWindow._evaluateSnap = evaluateSnap;

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  let icon;
  try {
    icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    if (icon.isEmpty()) throw new Error('empty');
    // Tray icons look best small
    icon = icon.resize({ width: 16, height: 16 });
  } catch (e) {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('Jot');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Widget', click: () => showWindow() },
    { label: 'Always on Top', type: 'checkbox', checked: alwaysOnTop, click: (item) => {
        alwaysOnTop = item.checked;
        if (mainWindow) mainWindow.setAlwaysOnTop(alwaysOnTop, 'floating');
      }
    },
    { label: 'Launch at Startup', type: 'checkbox', checked: isAutoLaunchEnabled(), click: (item) => {
        setAutoLaunch(item.checked);
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);

  // Single click on tray restores the window
  tray.on('click', () => showWindow());
}

function showWindow() {
  if (!mainWindow) createWindow();
  mainWindow.show();
  mainWindow.focus();
}

// Collapse to widget from the main process (used on blur / click-away)
function collapseToWidgetFromMain() {
  if (!mainWindow) return;
  snapSuppressUntil = Date.now() + 600;
  const [curX, curY] = mainWindow.getPosition();
  const { workArea } = screen.getDisplayNearestPoint({ x: curX, y: curY });

  isExpanded = false;
  mainWindow.setMinimumSize(WIDGET_SIZE.width, WIDGET_SIZE.height);
  mainWindow.setResizable(false);

  let x = widgetAnchor ? widgetAnchor.x : curX;
  let y = widgetAnchor ? widgetAnchor.y : curY;
  x = Math.max(workArea.x, Math.min(workArea.x + workArea.width - WIDGET_SIZE.width, x));
  y = Math.max(workArea.y, Math.min(workArea.y + workArea.height - WIDGET_SIZE.height, y));
  mainWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: WIDGET_SIZE.width, height: WIDGET_SIZE.height });

  // Tell the renderer to swap its UI to widget mode
  mainWindow.webContents.send('force-widget-ui');
}

// ===== IPC: renderer asks main to resize/minimize =====
ipcMain.on('resize-window', (event, state) => {
  if (!mainWindow) return;
  const [curX, curY] = mainWindow.getPosition();
  const { workArea } = screen.getDisplayNearestPoint({ x: curX, y: curY });

  if (state === 'expanded') {
    // Remember where the widget was, so collapse can restore it exactly
    widgetAnchor = { x: curX, y: curY };
    isExpanded = true;
    snapSuppressUntil = Date.now() + 600; // don't snap right after expanding

    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(MIN_EXPANDED.width, MIN_EXPANDED.height);
    mainWindow.setSize(EXPANDED_SIZE.width, EXPANDED_SIZE.height);

    // Anchor: keep the widget's top-left, but if that puts the window
    // off-screen, shift it back in. Prefer expanding from the widget corner.
    let x = curX;
    let y = curY;
    // If widget was near the right edge, expand leftward so it stays visible
    if (x + EXPANDED_SIZE.width > workArea.x + workArea.width) {
      x = workArea.x + workArea.width - EXPANDED_SIZE.width;
    }
    if (y + EXPANDED_SIZE.height > workArea.y + workArea.height) {
      y = workArea.y + workArea.height - EXPANDED_SIZE.height;
    }
    x = Math.max(workArea.x, x);
    y = Math.max(workArea.y, y);
    mainWindow.setPosition(Math.round(x), Math.round(y));

  } else { // widget
    // Clear the minimum first, otherwise the window can't shrink to widget size
    mainWindow.setMinimumSize(WIDGET_SIZE.width, WIDGET_SIZE.height);
    mainWindow.setResizable(false);
    isExpanded = false;

    // Restore the widget to its remembered position (clamped on-screen)
    let x = widgetAnchor ? widgetAnchor.x : curX;
    let y = widgetAnchor ? widgetAnchor.y : curY;
    x = Math.max(workArea.x, Math.min(workArea.x + workArea.width - WIDGET_SIZE.width, x));
    y = Math.max(workArea.y, Math.min(workArea.y + workArea.height - WIDGET_SIZE.height, y));

    // Atomic bounds set (position + size in one call) — reliably shrinks the window
    mainWindow.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: WIDGET_SIZE.width,
      height: WIDGET_SIZE.height,
    });
  }
});

ipcMain.on('minimize-to-tray', () => {
  if (mainWindow) mainWindow.hide();
});

// Real OS minimize — keeps the app in the Windows taskbar
ipcMain.on('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

// Move the OS window to an absolute position (used for widget dragging)
ipcMain.on('move-window', (event, mouseX, mouseY, offsetX, offsetY) => {
  if (!mainWindow) return;
  // Guard against NaN/undefined coords (can happen on rapid pointer events) — would crash setPosition
  if (![mouseX, mouseY, offsetX, offsetY].every(v => typeof v === 'number' && isFinite(v))) return;
  const nx = Math.round(mouseX - offsetX);
  const ny = Math.round(mouseY - offsetY);
  if (!isFinite(nx) || !isFinite(ny)) return;
  try { mainWindow.setPosition(nx, ny); } catch (e) { return; }
  // In widget mode, track the anchor in memory (persisted on drag-end, not every frame)
  if (!mainWindow.isResizable()) {
    widgetAnchor = { x: nx, y: ny };
  }
});

// Persist widget position once, when dragging ends
ipcMain.on('move-window-end', () => {
  if (widgetAnchor) saveSettings({ widgetX: widgetAnchor.x, widgetY: widgetAnchor.y });
});

ipcMain.on('set-always-on-top', (event, value) => {
  alwaysOnTop = value;
  if (mainWindow) mainWindow.setAlwaysOnTop(value, 'floating');
});

ipcMain.on('quit-app', () => {
  app.isQuitting = true;
  app.quit();
});

// Auto-launch: renderer can toggle and query
ipcMain.on('set-auto-launch', (event, value) => {
  setAutoLaunch(value);
});

ipcMain.handle('get-auto-launch', () => {
  return isAutoLaunchEnabled();
});

// ===== DAILY AUTO-BACKUP =====
// The renderer sends its data; we write at most one backup per day,
// keeping the last 7 in <userData>/backups.
ipcMain.on('auto-backup', (event, jsonString) => {
  try {
    const dir = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(dir, { recursive: true });

    const today = new Date().toISOString().slice(0, 10);
    const file = path.join(dir, `jot-autobackup-${today}.json`);

    // Only write once per day
    if (fs.existsSync(file)) return;
    fs.writeFileSync(file, jsonString);

    // Prune: keep the 7 most recent
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('jot-autobackup-'))
      .sort()
      .reverse();
    files.slice(7).forEach(f => {
      try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
    });
  } catch (e) { /* non-fatal */ }
});

// Let the renderer open the backups folder from the UI
ipcMain.on('open-backups-folder', () => {
  const dir = path.join(app.getPath('userData'), 'backups');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  require('electron').shell.openPath(dir);
});

// Open a hyperlink in the user's default browser
ipcMain.on('open-external', (event, url) => {
  if (url && /^https?:\/\//i.test(url)) {
    require('electron').shell.openExternal(url);
  }
});

// Renderer tells us when a note editor is open (so we don't collapse mid-edit)
ipcMain.on('set-editing', (event, editing) => {
  isEditingNote = !!editing;
});

// Renderer: titlebar drag ended → evaluate snap once (drop-based, not pause-based)
ipcMain.on('window-drop', () => {
  destroySnapPreview();
  if (mainWindow && mainWindow._evaluateSnap) mainWindow._evaluateSnap();
});

// ===== SNAP PREVIEW OVERLAY =====
let snapPreviewWin = null;

function computeSnapBounds() {
  const pt = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(pt).workArea;
  const T = 24, halfW = Math.floor(wa.width / 2), halfH = Math.floor(wa.height / 2);
  const nl = pt.x <= wa.x + T, nr = pt.x >= wa.x + wa.width - T;
  const nt = pt.y <= wa.y + T, nb = pt.y >= wa.y + wa.height - T;
  if (nt && nl) return { x: wa.x, y: wa.y, width: halfW, height: halfH };
  if (nt && nr) return { x: wa.x + halfW, y: wa.y, width: wa.width - halfW, height: halfH };
  if (nb && nl) return { x: wa.x, y: wa.y + halfH, width: halfW, height: wa.height - halfH };
  if (nb && nr) return { x: wa.x + halfW, y: wa.y + halfH, width: wa.width - halfW, height: wa.height - halfH };
  if (nl) return { x: wa.x, y: wa.y, width: halfW, height: wa.height };
  if (nr) return { x: wa.x + halfW, y: wa.y, width: wa.width - halfW, height: wa.height };
  if (nt) return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
  return null;
}

function showSnapPreview() {
  const b = computeSnapBounds();
  if (!b) { destroySnapPreview(); return; }
  if (!snapPreviewWin) {
    snapPreviewWin = new BrowserWindow({
      frame: false, transparent: true, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
      webPreferences: { contextIsolation: true },
    });
    snapPreviewWin.setIgnoreMouseEvents(true);
    snapPreviewWin.setAlwaysOnTop(true, 'screen-saver');
    snapPreviewWin.loadURL('data:text/html,' + encodeURIComponent(
      '<body style="margin:0;overflow:hidden;"><div style="width:100vw;height:100vh;box-sizing:border-box;background:rgba(124,92,252,0.22);border:2px solid rgba(124,92,252,0.8);border-radius:8px;"></div></body>'
    ));
  }
  snapPreviewWin.setBounds(b);
  if (!snapPreviewWin.isVisible()) snapPreviewWin.showInactive();
}

function destroySnapPreview() {
  if (snapPreviewWin) { try { snapPreviewWin.close(); } catch (e) {} snapPreviewWin = null; }
}

// Renderer sends this on each titlebar drag move → update the preview
ipcMain.on('snap-preview', () => {
  if (isExpanded) showSnapPreview();
});

// Briefly suppress click-away collapse (during file dialogs / link opens)
ipcMain.on('suppress-collapse', () => {
  suppressCollapse = true;
  setTimeout(() => { suppressCollapse = false; }, 1500);
});

// Reminders: renderer syncs the current task list with due dates
ipcMain.on('sync-reminders', (event, tasks) => {
  reminderTasks = Array.isArray(tasks) ? tasks : [];
  // Drop notified IDs that no longer exist or are completed (so re-adding re-notifies)
  const validIds = new Set(reminderTasks.filter(t => !t.completed).map(t => t.id));
  for (const id of [...notifiedTaskIds]) {
    if (!validIds.has(id)) notifiedTaskIds.delete(id);
  }
  checkReminders();
});

ipcMain.on('set-reminders', (event, enabled) => {
  remindersEnabled = !!enabled;
  if (remindersEnabled) startReminderTimer();
  else if (reminderTimer) { clearInterval(reminderTimer); reminderTimer = null; }
});

// ===== APP LIFECYCLE =====
app.whenReady().then(() => {
  createWindow();
  createTray();

  // Global hotkey to summon the widget from anywhere (even from tray)
  try {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
      if (!mainWindow) { createWindow(); return; }
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (e) { /* hotkey may be taken by another app; ignore */ }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Don't quit when window closes — stay in tray
app.on('window-all-closed', (e) => {
  // Keep running in tray on all platforms
});

// Single instance lock so only one widget runs
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}
