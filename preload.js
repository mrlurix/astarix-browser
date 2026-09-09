const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('minimize'),
  maximize: () => ipcRenderer.send('maximize'),
  openDevTools: () => ipcRenderer.send('open-webview-devtools'),
  close: () => ipcRenderer.send('close'),
  isMaximized: () => ipcRenderer.invoke('isMaximized'),
  onDownloadStart: (cb) => ipcRenderer.on('download-start', (_e, d) => cb(d)),
  onDownloadDone: (cb) => ipcRenderer.on('download-done', (_e, d) => cb(d)),
  loadExtension: () => ipcRenderer.invoke('load-extension'),
  onOpenUrl: (cb) => ipcRenderer.on('open-url', (_e, url) => cb(url)),
  setDownloadsFolder: (dir) => ipcRenderer.send('set-downloads-folder', dir),
});
