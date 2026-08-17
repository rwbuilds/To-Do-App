const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;

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
const WIDGET_SIZE = { width: 72, height: 72 };
const EXPANDED_SIZE = { width: 440, height: 700 };

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WIDGET_SIZE.width,
    height: WIDGET_SIZE.height,
    frame: false,              // no OS title bar — we draw our own
    transparent: true,         // allows the rounded/transparent widget
    resizable: false,
    alwaysOnTop: true,         // real always-on-top
    skipTaskbar: false,
    hasShadow: false,          // no OS shadow — we style our own
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Keep it above fullscreen apps too
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.loadFile('index.html');

  // Position in top-right by default
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow.setPosition(sw - WIDGET_SIZE.width - 40, 60);

  // If launched by Windows at startup, stay hidden in the tray
  if (launchedAtStartup()) {
    mainWindow.hide();
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  // A simple 1x1 fallback icon so it works even without an icon file
  let icon;
  try {
    icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    if (icon.isEmpty()) throw new Error('empty');
  } catch (e) {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('Quick Notes Widget');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Widget', click: () => showWindow() },
    { label: 'Always on Top', type: 'checkbox', checked: true, click: (item) => {
        if (mainWindow) mainWindow.setAlwaysOnTop(item.checked, 'screen-saver');
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
  let [x, y] = mainWindow.getPosition();
  const targetW = state === 'expanded' ? EXPANDED_SIZE.width : WIDGET_SIZE.width;
  const targetH = state === 'expanded' ? EXPANDED_SIZE.height : WIDGET_SIZE.height;
  mainWindow.setSize(targetW, targetH);

  // Keep the window fully on the current display
  const { workArea } = screen.getDisplayNearestPoint({ x, y });
  x = Math.max(workArea.x, Math.min(workArea.x + workArea.width - targetW, x));
  y = Math.max(workArea.y, Math.min(workArea.y + workArea.height - targetH, y));
  mainWindow.setPosition(x, y);
});

ipcMain.on('minimize-to-tray', () => {
  if (mainWindow) mainWindow.hide();
});

// Move the OS window to an absolute position (used for widget dragging)
ipcMain.on('move-window', (event, mouseX, mouseY, offsetX, offsetY) => {
  if (!mainWindow) return;
  // Place the window so the cursor keeps the same grab offset
  mainWindow.setPosition(Math.round(mouseX - offsetX), Math.round(mouseY - offsetY));
});

ipcMain.on('set-always-on-top', (event, value) => {
  if (mainWindow) mainWindow.setAlwaysOnTop(value, 'screen-saver');
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

// ===== APP LIFECYCLE =====
app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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
