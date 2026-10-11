const { app, BrowserWindow, session, ipcMain, dialog, webContents, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const storeClient = require('./lib/store-client');
const { screenManifest } = require('./lib/extension-guard');

let mainWindow;
// A single pending save path was a race: any other download that started in
// the same window could consume it. It is now bound to one exact URL and
// expires quickly, so an unrelated download can never be written there.
let pendingSave = null; // { path, url, ts }
let customDownloadsDir = '';

// Chrome Web Store extensions are unpacked into our own app-data folder and
// remembered here so they can be re-loaded on the next launch.
const storeRootDir = path.join(app.getPath('userData'), 'store-extensions');
let storeInstalled = [];

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

// -- Resource tuning ------------------------------------------------
// The app targets weak machines first: background services stay off,
// caches stay small, and low-end hardware gets an extra-tight budget.
const os = require('os');
const totalMemGB = os.totalmem() / (1024 * 1024 * 1024);
const coreCount = os.cpus().length;
const LOW_END = coreCount <= 2 || totalMemGB <= 4;

app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('no-first-run');

if (LOW_END) {
  // Tight memory + single raster thread: keeps paging down on old CPUs.
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=384');
  app.commandLine.appendSwitch('disk-cache-size', String(16 * 1024 * 1024));
  app.commandLine.appendSwitch('renderer-process-limit', '1');
  app.commandLine.appendSwitch('num-raster-threads', '1');
  app.commandLine.appendSwitch('disable-partial-raster');
  app.commandLine.appendSwitch('disable-features',
    'Translate,MediaRouter,CalculateNativeWinOcclusion,BackForwardCache,LazyFrameLoading,ExtensionManifestV2Disabled');
  console.log('Low-end mode enabled: cores=' + coreCount + ' ram=' + totalMemGB.toFixed(1) + 'GB');
} else {
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1024');
  app.commandLine.appendSwitch('disk-cache-size', String(64 * 1024 * 1024));
  app.commandLine.appendSwitch('disable-features', 'Translate,MediaRouter,CalculateNativeWinOcclusion');
}

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
            pendingSave = { path: filePath, url: imgUrl, ts: Date.now() };
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
    // Defence in depth: the renderer also guards these, but the main process
    // is the authority that cannot be bypassed by page script.
    const isHttp = (u) => typeof u === 'string' && (u.startsWith('http://') || u.startsWith('https://'));
    contents.on('will-redirect', (event, url) => {
      if (!isHttp(url)) event.preventDefault();
    });
    contents.on('will-navigate', (event, url) => {
      if (!isHttp(url)) event.preventDefault();
    });
    return;
  }

  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // The chrome window only ever shows our own local UI. Programmatic loads
  // (loadFile) do not emit will-navigate, so blocking every navigation here is
  // safe and prevents a remote page from ever inheriting the preload bridge.
  contents.on('will-navigate', (event) => event.preventDefault());
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

// Only the app's own top-level frame may talk to the main process.
function isTrustedSender(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const wc = mainWindow.webContents;
  if (event.sender !== wc) return false;
  if (event.senderFrame && event.senderFrame !== wc.mainFrame) return false;
  return true;
}

ipcMain.on('minimize', (event) => { if (isTrustedSender(event)) mainWindow?.minimize(); });
ipcMain.on('maximize', (event) => {
  if (!isTrustedSender(event)) return;
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('close', (event) => { if (isTrustedSender(event)) mainWindow?.close(); });
ipcMain.handle('isMaximized', (event) => (isTrustedSender(event) ? !!mainWindow?.isMaximized() : false));
function sanitizeFilename(name) {
  let n = path.basename(String(name || 'download'));
  // Windows strips trailing dots and spaces, which can turn a harmless name
  // into a reserved device name (e.g. "CON " -> "CON").
  n = n.replace(/[. ]+$/, '');
  n = n.replace(/^[. ]+/, '');
  if (!n) n = 'download';
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  if (reserved.test(n)) n = '_' + n;
  if (n.length > 100) n = n.slice(0, 100);
  return n;
}

ipcMain.on('set-downloads-folder', (event, dir) => {
  if (!isTrustedSender(event)) return;
  if (typeof dir !== 'string') return;
  const t = dir.trim();
  if (!t || t.length > 260 || t.includes('\0')) return;
  if (!path.isAbsolute(t)) return;
  customDownloadsDir = path.normalize(t);
});

ipcMain.on('open-webview-devtools', (event) => {
  if (!isTrustedSender(event)) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const all = webContents.getAllWebContents();
  for (const wc of all) {
    if (wc.hostWebContents && wc.hostWebContents.id === mainWindow.webContents.id) {
      wc.openDevTools();
      return;
    }
  }
});

ipcMain.handle('load-extension', async (event) => {
  if (!isTrustedSender(event)) return null;
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

    // Shared screening: identical rules for local folders and store installs.
    const screened = screenManifest(manifest);
    if (!screened.ok) return { error: screened.error, reason: screened.reason };

    const name = typeof manifest.name === 'string' ? manifest.name.slice(0, 100) : 'Unnamed Extension';
    await session.defaultSession.loadExtension(extPath);
    return { name: (typeof manifest.name === 'string' ? manifest.name : 'Unnamed Extension'), path: extPath };
  } catch (err) {
    return { error: err.message };
  }
});

// ── Chrome Web Store ─────────────────────────────────────────
function storeListFile() {
  return path.join(app.getPath('userData'), 'store-extensions.json');
}

// Persisted as a plain list of records; anything unexpected is dropped so a
// corrupted file can never stop the app from starting.
function persistStoreList() {
  try {
    const clean = storeInstalled
      .filter(e => e && typeof e.id === 'string' && storeClient.isValidExtensionId(e.id))
      .map(e => ({
        id: e.id, name: String(e.name || '').slice(0, 100),
        version: String(e.version || '').slice(0, 20),
        path: String(e.path || '').slice(0, 400),
        permissions: Array.isArray(e.permissions) ? e.permissions.slice(0, 30).map(p => String(p).slice(0, 40)) : [],
        hosts: Array.isArray(e.hosts) ? e.hosts.slice(0, 30).map(p => String(p).slice(0, 120)) : [],
      }));
    fs.writeFileSync(storeListFile(), JSON.stringify(clean), 'utf8');
  } catch (_) {}
}

function loadStoreList() {
  try {
    const raw = JSON.parse(fs.readFileSync(storeListFile(), 'utf8'));
    if (!Array.isArray(raw)) return [];
    const root = path.resolve(storeRootDir) + path.sep;
    return raw.filter(e => {
      if (!e || !storeClient.isValidExtensionId(e.id)) return false;
      if (typeof e.path !== 'string') return false;
      // The recorded path must live inside our managed folder; anything else
      // is discarded rather than loaded.
      return path.resolve(e.path).startsWith(root);
    }).slice(0, 20);
  } catch (_) { return []; }
}

// Re-load previously installed store extensions at startup, re-screening
// each one first so a tampered-on-disk extension cannot slip in.
async function restoreStoreExtensions() {
  const saved = loadStoreList();
  const restored = [];
  for (const record of saved) {
    try {
      const manifest = storeClient.readManifest(record.path);
      const screened = screenManifest(manifest);
      if (!screened.ok) continue;
      await session.defaultSession.loadExtension(record.path);
      restored.push(record);
    } catch (_) {}
  }
  storeInstalled = restored;
}


// The renderer may only ever pass an extension ID (or a Web Store URL
// containing one). It can never supply a URL, so this endpoint cannot be
// abused to fetch arbitrary hosts.

function storeList() {
  return storeInstalled.map(e => ({
    id: e.id,
    name: e.name,
    version: e.version,
    permissions: e.permissions || [],
    hosts: e.hosts || [],
  }));
}

ipcMain.handle('store-install', async (event, input) => {
  if (!isTrustedSender(event)) return { error: 'Not allowed' };

  const id = storeClient.extractId(input);
  if (!id) return { error: 'That does not look like a Chrome Web Store extension ID or link.' };

  let crxBuf;
  try {
    crxBuf = await storeClient.downloadCrx(id);
  } catch (err) {
    return { error: err.message };
  }

  // Unpack + screen. Nothing is loaded until the manifest passes.
  const result = storeClient.installFromCrx(id, crxBuf, storeRootDir);
  if (result.error) return { error: result.error, reason: result.reason };

  try {
    await session.defaultSession.loadExtension(result.path);
  } catch (err) {
    try { fs.rmSync(result.path, { recursive: true, force: true }); } catch (_) {}
    return { error: 'The extension could not be loaded: ' + err.message };
  }

  storeInstalled = storeInstalled.filter(e => e.id !== id);
  storeInstalled.push({
    id, name: result.name, version: result.version,
    path: result.path, permissions: result.permissions || [], hosts: result.hosts || [],
  });
  persistStoreList();

  return { id, name: result.name, version: result.version, installed: storeList() };
});

ipcMain.handle('store-remove', async (event, id) => {
  if (!isTrustedSender(event)) return { error: 'Not allowed' };
  if (!storeClient.isValidExtensionId(id)) return { error: 'Invalid extension ID' };

  const record = storeInstalled.find(e => e.id === id);
  if (!record) return { removed: false, installed: storeList() };

  try {
    const ext = session.defaultSession.getExtension(id);
    if (ext) await ext.remove();
  } catch (_) {}

  // Only ever delete inside our own managed folder.
  const target = path.join(storeRootDir, id);
  if (path.resolve(target).startsWith(path.resolve(storeRootDir) + path.sep)) {
    try { fs.rmSync(target, { recursive: true, force: true }); } catch (_) {}
  }

  storeInstalled = storeInstalled.filter(e => e.id !== id);
  persistStoreList();
  return { removed: true, installed: storeList() };
});

ipcMain.handle('store-list', (event) => {
  if (!isTrustedSender(event)) return [];
  return storeList();
});

app.whenReady().then(() => {
  session.defaultSession.setSpellCheckerEnabled(false);

  // Default-deny. A deny-list would silently grant any permission a future
  // Chromium update introduces, so only the handful of harmless ones pass.
  const ALLOWED_PERMISSIONS = new Set([
    'fullscreen',
    'clipboard-sanitized-write',
    'clipboard-write',
    'mediaKeySystem',
    'idle-detection',
  ]);
  const isAllowed = (permission) => ALLOWED_PERMISSIONS.has(permission);

  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(isAllowed(permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => isAllowed(permission));

  session.defaultSession.on('will-download', async (e, item) => {
    let savePath = null;

    // Use the pre-approved path only when it belongs to THIS download and is
    // still fresh. Otherwise the user is asked, so an unrelated download can
    // never be silently redirected into the chosen file.
    const p = pendingSave;
    if (p) {
      pendingSave = null;
      if (Date.now() - p.ts < 30000 && item.getURL() === p.url) savePath = p.path;
    }
    if (!savePath) {
      const safeName = sanitizeFilename(item.getFilename());
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save File',
        defaultPath: path.join(customDownloadsDir || app.getPath('downloads'), safeName),
      });
      if (canceled || !filePath) { e.preventDefault(); return; }
      savePath = filePath;
    }

    item.setSavePath(savePath);

    const win = mainWindow;
    if (!win || win.isDestroyed()) return;
    const filename = String(item.getFilename() || 'download').slice(0, 100);
    const url = String(item.getURL() || '').slice(0, 2000);
    win.webContents.send('download-start', { filename, url });
    item.on('done', (event, state) => {
      if (win.isDestroyed()) return;
      win.webContents.send('download-done', { filename, completed: state === 'completed' });
    });
  });

  restoreStoreExtensions()
    .catch(() => { storeInstalled = []; })
    .finally(() => createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
