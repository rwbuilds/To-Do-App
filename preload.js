const { contextBridge, ipcRenderer } = require('electron');

// Safe API exposed to the page (window.widgetAPI)
contextBridge.exposeInMainWorld('widgetAPI', {
  resizeWindow: (state) => ipcRenderer.send('resize-window', state),
  minimizeToTray: () => ipcRenderer.send('minimize-to-tray'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  moveWindow: (mouseX, mouseY, offsetX, offsetY) => ipcRenderer.send('move-window', mouseX, mouseY, offsetX, offsetY),
  moveWindowEnd: () => ipcRenderer.send('move-window-end'),
  setAlwaysOnTop: (value) => ipcRenderer.send('set-always-on-top', value),
  quitApp: () => ipcRenderer.send('quit-app'),
  setAutoLaunch: (value) => ipcRenderer.send('set-auto-launch', value),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  autoBackup: (jsonString) => ipcRenderer.send('auto-backup', jsonString),
  openBackupsFolder: () => ipcRenderer.send('open-backups-folder'),
  onCollapseOnBlur: (cb) => ipcRenderer.on('collapse-on-blur', cb),
  openExternal: (url) => ipcRenderer.send('open-external', url),
});
