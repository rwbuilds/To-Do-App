const { contextBridge, ipcRenderer } = require('electron');

// Safe API exposed to the page (window.widgetAPI)
contextBridge.exposeInMainWorld('widgetAPI', {
  resizeWindow: (state) => ipcRenderer.send('resize-window', state),
  minimizeToTray: () => ipcRenderer.send('minimize-to-tray'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  moveWindow: (mouseX, mouseY, offsetX, offsetY) => ipcRenderer.send('move-window', mouseX, mouseY, offsetX, offsetY),
  moveWindowEnd: () => ipcRenderer.send('move-window-end'),
  windowDrop: () => ipcRenderer.send('window-drop'),
  snapPreview: () => ipcRenderer.send('snap-preview'),
  setDragging: (v) => ipcRenderer.send('set-dragging', v),
  resizeTo: (w, h) => ipcRenderer.send('resize-to', w, h),
  setAlwaysOnTop: (value) => ipcRenderer.send('set-always-on-top', value),
  quitApp: () => ipcRenderer.send('quit-app'),
  setAutoLaunch: (value) => ipcRenderer.send('set-auto-launch', value),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  autoBackup: (jsonString) => ipcRenderer.send('auto-backup', jsonString),
  openBackupsFolder: () => ipcRenderer.send('open-backups-folder'),
  onCollapseOnBlur: (cb) => ipcRenderer.on('collapse-on-blur', cb),
  onForceWidgetUI: (cb) => ipcRenderer.on('force-widget-ui', cb),
  onQuickAdd: (cb) => ipcRenderer.on('quick-add', cb),
  setEditing: (editing) => ipcRenderer.send('set-editing', editing),
  suppressCollapse: () => ipcRenderer.send('suppress-collapse'),
  syncReminders: (tasks) => ipcRenderer.send('sync-reminders', tasks),
  setReminders: (enabled) => ipcRenderer.send('set-reminders', enabled),
  onFocusTask: (cb) => ipcRenderer.on('focus-task', (e, id) => cb(id)),
  openExternal: (url) => ipcRenderer.send('open-external', url),
});
