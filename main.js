const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let alwaysOnTop = true;
let isExpanded = false;   // explicit expanded/widget state for reliable blur handling

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
    },
  });

  // Keep it above fullscreen apps too
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.loadFile('index.html');

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

  // Clicking away (losing focus) collapses the expanded app back to the widget
  mainWindow.on('blur', () => {
    if (!mainWindow || !isExpanded) return;
    // Tell the renderer to collapse (it handles the note-editing guard + UI swap)
    mainWindow.webContents.send('collapse-on-blur');
  });

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

// ===== IPC: renderer asks main to resize/minimize =====
ipcMain.on('resize-window', (event, state) => {
  if (!mainWindow) return;
  const [curX, curY] = mainWindow.getPosition();
  const { workArea } = screen.getDisplayNearestPoint({ x: curX, y: curY });

  if (state === 'expanded') {
    // Remember where the widget was, so collapse can restore it exactly
    widgetAnchor = { x: curX, y: curY };
    isExpanded = true;

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
  // Place the window so the cursor keeps the same grab offset
  const nx = Math.round(mouseX - offsetX);
  const ny = Math.round(mouseY - offsetY);
  mainWindow.setPosition(nx, ny);
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
