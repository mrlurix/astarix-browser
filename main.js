const { app, BrowserWindow, session, ipcMain, dialog, webContents, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let pendingSavePath = null;
let customDownloadsDir = '';

const blockedSwitches = [
  'remote-debugging-port',
  'remote-debugging-pipe',
  'inspect',
  'inspect-brk',
  'no-sandbox',
  'disable-web-security',
  'allow-running-insecure-content',
  'load-extension',
  'proxy-server',
  'proxy-bypass-list',
  'host-resolver-rules',
  'disable-site-isolation-trials',
];
for (const s of blockedSwitches) {
  if (app.commandLine.hasSwitch(s)) {
    console.error('Blocked switch:', s);
    app.exit(1);
    process.exit(1);
  }
}
const df = app.commandLine.getSwitchValue('disable-features') || '';
if (df.includes('RendererCodeIntegrity') || df.includes('OutOfBlinkCors') || df.includes('IsolateOrigins') || df.includes('site-per-process')) {
  console.error('Blocked disable-features:', df);
  app.exit(1);
  process.exit(1);
}
const no = process.env.NODE_OPTIONS || '';
if (no.includes('--inspect') || no.includes('--require') || no.includes('--import') || process.env.ELECTRON_RUN_AS_NODE) {
  console.error('Blocked node injection');
  app.exit(1);
  process.exit(1);
}
for (const a of process.execArgv) {
  if (a.includes('--inspect')) {
    console.error('Blocked inspector argv');
    app.exit(1);
    process.exit(1);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1024');
app.commandLine.appendSwitch('disable-features', 'Translate,MediaRouter,CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disk-cache-size', String(64 * 1024 * 1024));
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('no-first-run');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 700,
    minWidth: 400,
    minHeight: 300,
    frame: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'renderer', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
      backgroundThrottling: true,
    },
  });

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36' } });
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function attachContextMenu(contents) {
  contents.on('context-menu', (_event, params) => {
    const hasSelection = params.selectionText && params.selectionText.trim().length > 0;
    const isEditable = params.isEditable;
    const template = [];

    if (contents.getType() === 'webview') {
      template.push({ label: 'Back', enabled: contents.canGoBack(), click: () => contents.goBack() });
      template.push({ label: 'Forward', enabled: contents.canGoForward(), click: () => contents.goForward() });
      template.push({ label: 'Reload', click: () => contents.reload() });
      template.push({ type: 'separator' });

      if (isEditable) {
        template.push({ label: 'Cut', enabled: hasSelection, click: () => contents.cut() });
        template.push({ label: 'Copy', enabled: hasSelection, click: () => contents.copy() });
        template.push({ label: 'Paste', click: () => contents.paste() });
        template.push({ type: 'separator' });
      } else if (hasSelection) {
        template.push({ label: 'Copy', click: () => contents.copy() });
        template.push({ type: 'separator' });
      }

      if (params.linkURL && (params.linkURL.startsWith('http://') || params.linkURL.startsWith('https://'))) {
        const linkUrl = params.linkURL;
        template.push({ label: 'Open Link in New Tab', click: () => mainWindow?.webContents.send('open-url', linkUrl) });
        template.push({ label: 'Copy Link Address', click: () => clipboard.writeText(linkUrl) });
        template.push({ type: 'separator' });
      }

      if (params.mediaType === 'image' && params.srcURL && (params.srcURL.startsWith('http://') || params.srcURL.startsWith('https://'))) {
        const imgUrl = params.srcURL;
        template.push({
          label: 'Save Image As...',
          click: async () => {
            let defaultName = 'image.png';
            try { defaultName = sanitizeFilename(path.basename(new URL(imgUrl).pathname) || 'image.png'); } catch { defaultName = 'image.png'; }
            const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
              title: 'Save Image As',
              defaultPath: path.join(customDownloadsDir || app.getPath('downloads'), defaultName),
            });
            if (canceled || !filePath) return;
            pendingSavePath = filePath;
            contents.downloadURL(imgUrl);
          },
        });
        template.push({ type: 'separator' });
      }

      if (hasSelection) {
        const rawSel = params.selectionText.trim().slice(0, 500);
        const sel = rawSel;
        const label = sel.length > 30 ? sel.slice(0, 30) + '…' : sel;
        template.push({
          label: `Search Google for "${label}"`,
          click: () => mainWindow?.webContents.send('open-url', 'https://www.google.com/search?q=' + encodeURIComponent(sel)),
        });
        template.push({ type: 'separator' });
      }

      template.push({ label: 'Inspect', click: () => contents.openDevTools() });
    } else {
      if (isEditable) {
        template.push({ label: 'Cut', enabled: hasSelection, click: () => contents.cut() });
        template.push({ label: 'Copy', enabled: hasSelection, click: () => contents.copy() });
        template.push({ label: 'Paste', click: () => contents.paste() });
        template.push({ type: 'separator' });
      }
      template.push({ label: 'Inspect', click: () => contents.openDevTools() });
    }

    if (template.length) {
      Menu.buildFromTemplate(template).popup({ window: mainWindow });
    }
  });
}

app.on('web-contents-created', (_event, contents) => {
  attachContextMenu(contents);
  if (contents.getType() === 'webview') {
    contents.on('will-redirect', (event, url) => {
      if (!url.startsWith('http://') && !url.startsWith('https://')) event.preventDefault();
    });
    return;
  }

  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    try { const p = new URL(url).protocol; if (p !== 'http:' && p !== 'https:') event.preventDefault(); }
    catch { event.preventDefault(); }
  });
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    const src = params && params.src;
    if (src && !src.startsWith('http://') && !src.startsWith('https://')) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    delete webPreferences.preloadURL;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.navigateOnDragDrop = false;
    webPreferences.enableBlinkFeatures = '';
    webPreferences.experimentalFeatures = false;
  });
});

ipcMain.on('minimize', () => mainWindow?.minimize());
ipcMain.on('maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('close', () => mainWindow?.close());
ipcMain.handle('isMaximized', () => mainWindow?.isMaximized());
function sanitizeFilename(name) {
  let n = path.basename(String(name || 'download'));
  n = n.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.+$/, '').replace(/^\.+/, '');
  if (!n) n = 'download';
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  if (reserved.test(n)) n = '_' + n;
  if (n.length > 100) n = n.slice(0, 100);
  return n;
}

ipcMain.on('set-downloads-folder', (_e, dir) => {
  if (typeof dir !== 'string') return;
  const t = dir.trim();
  if (!t || t.length > 260 || t.includes('\0')) return;
  if (!path.isAbsolute(t)) return;
  customDownloadsDir = path.normalize(t);
});

ipcMain.on('open-webview-devtools', () => {
  if (!mainWindow) return;
  const all = webContents.getAllWebContents();
  for (const wc of all) {
    if (wc.hostWebContents && wc.hostWebContents.id === mainWindow.webContents.id) {
      wc.openDevTools();
      return;
    }
  }
});

ipcMain.handle('load-extension', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Extension Folder',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const extPath = result.filePaths[0];
  try {
    const manifestPath = path.join(extPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return { error: 'No manifest.json found' };
    const stat = fs.statSync(manifestPath);
    if (stat.size > 100000) return { error: 'manifest.json too large' };
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
    const hostPerms = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
    const optPerms = Array.isArray(manifest.optional_permissions) ? manifest.optional_permissions : [];
    const optHostPerms = Array.isArray(manifest.optional_host_permissions) ? manifest.optional_host_permissions : [];
    const allPerms = [...permissions, ...hostPerms, ...optPerms, ...optHostPerms];
    const dangerousPerms = ['nativeMessaging', 'webRequestBlocking', 'proxy', 'debugger', 'management', 'browsingData', 'privacy', 'cookies', 'downloads', 'declarativeNetRequest', 'declarativeNetRequestWithHostAccess'];
    if (allPerms.some(p => dangerousPerms.includes(p))) {
      return { error: 'Extension requests dangerous permissions and was blocked' };
    }
    if (allPerms.some(p => p === '<all_urls>' || p === '*://*/*')) {
      return { error: 'Extension requests overly broad host permissions and was blocked' };
    }
    const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
    for (const cs of contentScripts) {
      const matches = Array.isArray(cs.matches) ? cs.matches : [];
      if (matches.some(m => m === '<all_urls>' || m === '*://*/*')) {
        return { error: 'Extension content scripts request overly broad host access and was blocked' };
      }
    }
    if (typeof manifest.name === 'string' && manifest.name.length > 100) manifest.name = manifest.name.slice(0, 100);
    await session.defaultSession.loadExtension(extPath);
    return { name: (typeof manifest.name === 'string' ? manifest.name : 'Unnamed Extension'), path: extPath };
  } catch (err) {
    return { error: err.message };
  }
});

app.whenReady().then(() => {
  session.defaultSession.setSpellCheckerEnabled(false);

  const dangerous = ['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'pointerLock', 'openExternal', 'serial', 'usb', 'bluetooth', 'hid', 'clipboard-read', 'display-capture'];
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(!dangerous.includes(permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => !dangerous.includes(permission));

  session.defaultSession.on('will-download', async (e, item) => {
    let savePath = pendingSavePath;
    if (savePath) {
      pendingSavePath = null;
    } else {
      const safeName = sanitizeFilename(item.getFilename());
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save File',
        defaultPath: path.join(customDownloadsDir || app.getPath('downloads'), safeName),
      });
      if (canceled || !filePath) { e.preventDefault(); return; }
      savePath = filePath;
    }
    item.setSavePath(savePath);
    const filename = item.getFilename();
    mainWindow.webContents.send('download-start', { filename, url: item.getURL() });
    item.on('done', (event, state) => {
      mainWindow.webContents.send('download-done', { filename, completed: state === 'completed' });
    });
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
