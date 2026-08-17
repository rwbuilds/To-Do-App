const { contextBridge, ipcRenderer } = require('electron');

// Safe API exposed to the page (window.widgetAPI)
contextBridge.exposeInMainWorld('widgetAPI', {
  resizeWindow: (state) => ipcRenderer.send('resize-window', state),
  minimizeToTray: () => ipcRenderer.send('minimize-to-tray'),
  moveWindow: (mouseX, mouseY, offsetX, offsetY) => ipcRenderer.send('move-window', mouseX, mouseY, offsetX, offsetY),
  snapWidget: () => ipcRenderer.send('snap-widget'),
  setAlwaysOnTop: (value) => ipcRenderer.send('set-always-on-top', value),
  quitApp: () => ipcRenderer.send('quit-app'),
  setAutoLaunch: (value) => ipcRenderer.send('set-auto-launch', value),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  autoBackup: (jsonString) => ipcRenderer.send('auto-backup', jsonString),
  openBackupsFolder: () => ipcRenderer.send('open-backups-folder'),
});
