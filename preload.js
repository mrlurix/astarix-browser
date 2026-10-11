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
  setMemorySaver: (on) => ipcRenderer.send('set-memory-saver', !!on),

  // Chrome Web Store: the argument is an extension ID or a Web Store URL.
  // The main process validates it and refuses anything that is not an ID,
  // so the renderer can never point this at an arbitrary host.
  storeInstall: (idOrUrl) => ipcRenderer.invoke('store-install', String(idOrUrl || '').slice(0, 500)),
  storeInstallFile: () => ipcRenderer.invoke('store-install-file'),
  storeRemove: (id) => ipcRenderer.invoke('store-remove', String(id || '')),
  storeList: () => ipcRenderer.invoke('store-list'),
});
