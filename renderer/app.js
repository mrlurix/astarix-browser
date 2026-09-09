function safeParseJSON(str, fallback) {
  if (str == null || str === '') return fallback;
  try { const v = JSON.parse(str); return v == null ? fallback : v; } catch (e) { return fallback; }
}

const tabs = [];
let activeTabId = null;
let tabCounter = 0;
let zoomFactor = 1.0;
const history = [];
const downloads = [];
function sanitizeStoredArray(raw, fallback) {
  const v = safeParseJSON(raw, fallback);
  return Array.isArray(v) ? v.slice(0, 200) : fallback;
}
let bookmarks = sanitizeStoredArray(localStorage.getItem('astarix-bookmarks'), []);
let extensions = sanitizeStoredArray(localStorage.getItem('astarix-extensions'), []);
bookmarks = bookmarks.filter(b => b && typeof b.url === 'string' && b.url.startsWith('http'));
extensions = extensions.filter(e => e && typeof e.name === 'string' && typeof e.path === 'string');

const webview = document.getElementById('webview');
const tabsBar = document.getElementById('tabs-bar');
const newtabBtn = document.getElementById('newtab-btn');
const omnibox = document.getElementById('omnibox');
const ntp = document.getElementById('ntp');
const ntpSearch = document.getElementById('ntp-search');
const ntpShortcuts = document.getElementById('ntp-shortcuts');
const suggestionsEl = document.getElementById('omnibox-suggestions');
const hamburger = document.getElementById('hamburger-menu');
const menuOverlay = document.getElementById('menu-overlay');
const menuBtn = document.getElementById('menu-btn');
const bookmarkBtn = document.getElementById('bookmark-btn');

const navBtns = {
  back: document.getElementById('back-btn'),
  fwd: document.getElementById('fwd-btn'),
  reload: document.getElementById('reload-btn'),
};

const panelOverlay = document.getElementById('panel-overlay');
const historyPanel = document.getElementById('history-panel');
const historyList = document.getElementById('history-list');
const downloadsPanel = document.getElementById('downloads-panel');
const downloadsList = document.getElementById('downloads-list');
const bookmarksPanel = document.getElementById('bookmarks-panel');
const bookmarksList = document.getElementById('bookmarks-list');
const extensionsPanel = document.getElementById('extensions-panel');
const extensionsList = document.getElementById('extensions-list');
const aboutPanel = document.getElementById('about-panel');
const settingsPanel = document.getElementById('settings-panel');

const searchEngines = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=', icon: 'G' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=', icon: 'B' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=', icon: 'D' },
};
const seKeys = Object.keys(searchEngines);

const defaultSettings = {
  theme: 'dark',
  accent: 'purple',
  startup: 'newtab',
  homepage: 'https://www.google.com',
  showShortcuts: true,
  ntpBackground: '',
  engine: 'google',
  suggestions: true,
  zoom: 1.0,
  downloadsDir: '',
};
const rawStored = safeParseJSON(localStorage.getItem('astarix-settings'), {});
const storedSettings = (rawStored && typeof rawStored === 'object' && !Array.isArray(rawStored)) ? rawStored : {};
const settings = {};
for (const k of Object.keys(defaultSettings)) {
  if (Object.prototype.hasOwnProperty.call(storedSettings, k)) {
    settings[k] = storedSettings[k];
  } else {
    settings[k] = defaultSettings[k];
  }
}
if (!storedSettings.engine) {
  const legacy = localStorage.getItem('astarix-engine');
  if (legacy && searchEngines[legacy]) settings.engine = legacy;
}
if (!searchEngines[settings.engine]) settings.engine = 'google';
if (typeof settings.theme !== 'string' || !['dark','light'].includes(settings.theme)) settings.theme = 'dark';
if (typeof settings.accent !== 'string' || !['purple','blue','green','red','orange','pink','teal'].includes(settings.accent)) settings.accent = 'purple';
if (typeof settings.startup !== 'string' || !['newtab','homepage'].includes(settings.startup)) settings.startup = 'newtab';
if (typeof settings.homepage !== 'string' || settings.homepage.length > 500) settings.homepage = defaultSettings.homepage;
if (typeof settings.showShortcuts !== 'boolean') settings.showShortcuts = true;
if (typeof settings.ntpBackground !== 'string' || settings.ntpBackground.length > 100) settings.ntpBackground = '';
else if (settings.ntpBackground && !/^#[0-9a-fA-F]{6}$/.test(settings.ntpBackground)) settings.ntpBackground = '';
if (typeof settings.suggestions !== 'boolean') settings.suggestions = true;
if (typeof settings.zoom !== 'number' || !isFinite(settings.zoom)) settings.zoom = 1.0;
settings.zoom = Math.min(3.0, Math.max(0.3, settings.zoom));
if (typeof settings.downloadsDir !== 'string' || settings.downloadsDir.length > 260) settings.downloadsDir = '';
if (typeof settings.engine !== 'string' || !searchEngines[settings.engine]) settings.engine = 'google';

let currentEngine = settings.engine;
zoomFactor = settings.zoom;
let suggestionIdx = -1;
let suggestTimer = null;

const defaultShortcuts = [
  { label: 'Google', icon: 'G', url: 'https://www.google.com' },
  { label: 'YouTube', icon: 'Y', url: 'https://www.youtube.com' },
  { label: 'GitHub', icon: 'GH', url: 'https://www.github.com' },
  { label: 'Reddit', icon: 'R', url: 'https://www.reddit.com' },
];

function normalizeInput(input) {
  input = input.trim();
  if (!input || input.length > 2000) return '';
  if (/[\x00-\x1f\x7f]/.test(input)) return null;
  if (/^https?:\/\//i.test(input)) {
    try { const u = new URL(input); if (u.protocol === 'http:' || u.protocol === 'https:') return input; } catch {}
    return null;
  }
  if (/^localhost(:\d+)?(\/.*)?$/i.test(input) || /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(input)) {
    return 'http://' + input;
  }
  if (/^(www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(input)) {
    return 'https://' + input;
  }
  return null;
}

async function fetchSuggestions(query) {
  if (!settings.suggestions) return [];
  if (typeof query !== 'string' || query.length > 200) return [];
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`, { signal: controller.signal });
    clearTimeout(t);
    if (!r.ok) return [];
    const data = await r.json();
    const arr = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
    return arr.slice(0, 8).filter(s => typeof s === 'string' && s.length <= 200);
  } catch { return []; }
}

function setEngine(key) {
  if (!searchEngines[key]) return;
  currentEngine = key;
  settings.engine = key;
  localStorage.setItem('astarix-engine', key);
  document.querySelectorAll('.engine-indicator').forEach(el => el.textContent = searchEngines[key].icon);
}

function saveSettings() {
  try { localStorage.setItem('astarix-settings', JSON.stringify(settings)); } catch {}
}

function hexToRgb(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return '139, 62, 255';
  const h = hex.slice(1);
  const n = parseInt(h, 16);
  if (!isFinite(n)) return '139, 62, 255';
  return ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255);
}

const accents = {
  purple: { deep: '#6d28d9', brand: '#8b3eff', vibrant: '#a855f7', soft: '#c084fc' },
  blue: { deep: '#1e40af', brand: '#3b82f6', vibrant: '#60a5fa', soft: '#93c5fd' },
  green: { deep: '#047857', brand: '#10b981', vibrant: '#34d399', soft: '#6ee7b7' },
  red: { deep: '#b91c1c', brand: '#ef4444', vibrant: '#f87171', soft: '#fca5a5' },
  orange: { deep: '#c2410c', brand: '#f97316', vibrant: '#fb923c', soft: '#fdba74' },
  pink: { deep: '#be185d', brand: '#ec4899', vibrant: '#f472b6', soft: '#f9a8d4' },
  teal: { deep: '#0f766e', brand: '#14b8a6', vibrant: '#2dd4bf', soft: '#5eead4' },
};

function applySettings() {
  document.body.classList.toggle('light', settings.theme === 'light');
  const a = accents[settings.accent] || accents.purple;
  document.documentElement.style.setProperty('--purple-deep', a.deep);
  document.documentElement.style.setProperty('--purple-brand', a.brand);
  document.documentElement.style.setProperty('--purple-vibrant', a.vibrant);
  document.documentElement.style.setProperty('--purple-soft', a.soft);
  document.documentElement.style.setProperty('--purple-subtle', 'rgba(' + hexToRgb(a.brand) + ', 0.12)');
  setEngine(settings.engine);
  zoomFactor = settings.zoom;
  try { webview.setZoomFactor(zoomFactor); } catch {}
  ntp.style.background = settings.ntpBackground || '';
  const scHidden = !settings.showShortcuts;
  document.getElementById('ntp-section-label').classList.toggle('hidden', scHidden);
  ntpShortcuts.classList.toggle('hidden', scHidden);
  if (window.electronAPI?.setDownloadsFolder && settings.downloadsDir) {
    window.electronAPI.setDownloadsFolder(settings.downloadsDir);
  }
}

function renderSettings() {
  document.getElementById('set-theme').value = settings.theme;
  document.getElementById('set-startup').value = settings.startup;
  document.getElementById('set-homepage').value = settings.homepage;
  document.getElementById('set-shortcuts').checked = settings.showShortcuts;
  document.getElementById('set-ntp-bg').value = settings.ntpBackground || '#000000';
  document.getElementById('set-engine').value = settings.engine;
  document.getElementById('set-suggestions').checked = settings.suggestions;
  document.getElementById('set-zoom').value = String(settings.zoom);
  document.getElementById('set-downloads').value = settings.downloadsDir;
  document.querySelectorAll('#set-accent-row .swatch').forEach(b =>
    b.classList.toggle('active', b.dataset.accent === settings.accent)
  );
}

function bindSettings() {
  document.getElementById('set-theme').addEventListener('change', e => {
    const v = e.target.value;
    if (!['dark','light'].includes(v)) return;
    settings.theme = v; saveSettings(); applySettings();
  });
  document.getElementById('set-startup').addEventListener('change', e => {
    const v = e.target.value;
    if (!['newtab','homepage'].includes(v)) return;
    settings.startup = v; saveSettings();
  });
  document.getElementById('set-homepage').addEventListener('change', e => {
    const v = e.target.value.trim().slice(0, 500);
    if (v && !normalizeInput(v)) return;
    settings.homepage = v || defaultSettings.homepage; saveSettings();
  });
  document.getElementById('set-shortcuts').addEventListener('change', e => { settings.showShortcuts = !!e.target.checked; saveSettings(); applySettings(); });
  document.getElementById('set-ntp-bg').addEventListener('change', e => {
    const v = e.target.value;
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) return;
    settings.ntpBackground = v; saveSettings(); applySettings();
  });
  document.getElementById('set-engine').addEventListener('change', e => {
    const v = e.target.value;
    if (!searchEngines[v]) return;
    settings.engine = v; saveSettings(); applySettings();
  });
  document.getElementById('set-suggestions').addEventListener('change', e => { settings.suggestions = !!e.target.checked; saveSettings(); });
  document.getElementById('set-zoom').addEventListener('change', e => {
    let z = parseFloat(e.target.value);
    if (!isFinite(z)) z = 1.0;
    settings.zoom = Math.min(3.0, Math.max(0.3, z));
    zoomFactor = settings.zoom;
    saveSettings();
    applyZoom();
  });
  document.getElementById('set-downloads').addEventListener('change', e => {
    const v = e.target.value.trim().slice(0, 260);
    if (v.includes('\0')) return;
    settings.downloadsDir = v;
    saveSettings();
    if (window.electronAPI?.setDownloadsFolder) window.electronAPI.setDownloadsFolder(settings.downloadsDir);
  });
  document.querySelectorAll('#set-accent-row .swatch').forEach(b =>
    b.addEventListener('click', () => { settings.accent = b.dataset.accent; saveSettings(); applySettings(); renderSettings(); })
  );
  document.getElementById('set-reset').addEventListener('click', () => {
    Object.keys(defaultSettings).forEach(k => settings[k] = defaultSettings[k]);
    saveSettings();
    applySettings();
    renderSettings();
  });
}

function openSettings() {
  closeMenu();
  renderSettings();
  settingsPanel.classList.remove('hidden');
  panelOverlay.classList.remove('hidden');
}

function cycleEngine() {
  const idx = seKeys.indexOf(currentEngine);
  setEngine(seKeys[(idx + 1) % seKeys.length]);
}

document.querySelectorAll('.engine-indicator').forEach(el => el.addEventListener('click', cycleEngine));
setEngine(currentEngine);

function buildUrl(input) {
  const url = normalizeInput(input);
  if (url) return url;
  return searchEngines[currentEngine].url + encodeURIComponent(input);
}

function navigate(input, tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  if (typeof input !== 'string' || input.length > 2000) return;
  const url = buildUrl(input);
  tab.url = url;
  tab.title = input.slice(0, 200);
  if (tabId === activeTabId) {
    ntp.classList.remove('active');
    webview.classList.add('active');
    try { webview.loadURL(url); } catch { webview.src = url; }
    omnibox.value = url;
  }
  updateTabDisplay(tabId, input);
  hideSuggestions();
}

function createTab(url) {
  if (tabs.length >= 30) return activeTabId;
  tabCounter++;
  const id = tabCounter;
  const tab = { id, url: '', title: 'New Tab' };
  tabs.push(tab);
  renderTab(id);
  activateTab(id);
  if (url) navigate(url, id);
  else ntpSearch.focus();
  return id;
}

function renderTab(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  const div = document.createElement('div');
  div.className = 'tab' + (tabId === activeTabId ? ' active' : '');
  div.dataset.tabId = tabId;
  div.innerHTML = `
    <div class="tab-icon">A</div>
    <span class="tab-title"></span>
    <button class="tab-close">✕</button>
  `;
  div.querySelector('.tab-icon').textContent = tab.title[0]?.toUpperCase() || 'A';
  div.querySelector('.tab-title').textContent = tab.title;
  div.addEventListener('click', e => { if (!e.target.closest('.tab-close')) activateTab(tabId); });
  div.querySelector('.tab-close').addEventListener('click', e => { e.stopPropagation(); closeTab(tabId); });
  tabsBar.appendChild(div);
}

function activateTab(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  activeTabId = tabId;
  document.querySelectorAll('.tab').forEach(el =>
    el.classList.toggle('active', parseInt(el.dataset.tabId) === tabId)
  );
  if (tab.url) {
    ntp.classList.remove('active');
    webview.classList.add('active');
    try { webview.loadURL(tab.url); } catch { webview.src = tab.url; }
    omnibox.value = tab.url;
    updateBookmarkBtn(tab.url);
  } else {
    webview.classList.remove('active');
    ntp.classList.add('active');
    omnibox.value = '';
    ntpSearch.value = '';
    ntpSearch.focus();
    updateBookmarkBtn('');
  }
}

function closeTab(tabId) {
  const idx = tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;
  tabs.splice(idx, 1);
  const el = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (el) el.remove();
  if (tabs.length === 0) {
    activeTabId = null;
    webview.classList.remove('active');
    ntp.classList.add('active');
    omnibox.value = '';
    return;
  }
  if (tabId === activeTabId) {
    activateTab(tabs[Math.min(idx, tabs.length - 1)].id);
  }
}

function updateTabDisplay(tabId, title) {
  const el = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (el) {
    el.querySelector('.tab-title').textContent = title;
    el.querySelector('.tab-icon').textContent = title[0]?.toUpperCase() || 'A';
  }
}

// ─── History ──────────────────────────────────────────────
function addHistory(url, title) {
  if (!url || typeof url !== 'string' || url.length > 2000) return;
  if (url === 'about:blank' || url.startsWith('chrome-devtools')) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;
  const safeTitle = typeof title === 'string' ? title.slice(0, 200) : url.slice(0, 200);
  history.unshift({ url: url.slice(0, 2000), title: safeTitle, time: Date.now() });
  if (history.length > 200) history.length = 200;
}

function renderHistory() {
  historyList.innerHTML = '';
  if (history.length === 0) { historyList.innerHTML = '<div class="panel-empty">No history yet</div>'; return; }
  history.forEach(h => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `<div class="hi-icon">↗</div><div class="hi-info"><div class="hi-title">${escapeHtml(h.title)}</div><div class="hi-url">${escapeHtml(h.url)}</div></div>`;
    div.addEventListener('click', () => { closePanel(); navigate(h.url, activeTabId || createTab()); });
    historyList.appendChild(div);
  });
}

// ─── Downloads ────────────────────────────────────────────
function renderDownloads() {
  downloadsList.innerHTML = '';
  if (downloads.length === 0) { downloadsList.innerHTML = '<div class="panel-empty">No downloads yet</div>'; return; }
  downloads.forEach(d => {
    const div = document.createElement('div');
    div.className = 'download-item';
    div.innerHTML = `<div class="di-icon">⬇</div><div class="di-info"><div class="di-name">${escapeHtml(d.filename)}</div><div class="di-status">${d.completed ? 'Completed' : 'In progress...'}</div></div>`;
    downloadsList.appendChild(div);
  });
}

// ─── Bookmarks ────────────────────────────────────────────
function saveBookmarks() {
  try { localStorage.setItem('astarix-bookmarks', JSON.stringify(bookmarks.slice(0, 100))); } catch {}
}

function addBookmark(url, title) {
  if (!url || url === 'about:blank') return;
  if (typeof url !== 'string' || url.length > 2000) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;
  if (bookmarks.length >= 100) return;
  if (bookmarks.some(b => b.url === url)) return;
  const safeTitle = typeof title === 'string' ? title.slice(0, 200) : url.slice(0, 200);
  bookmarks.unshift({ url: url.slice(0, 2000), title: safeTitle, time: Date.now() });
  saveBookmarks();
  renderBookmarks();
  renderNtpShortcuts();
  updateBookmarkBtn(url);
}

function removeBookmark(url) {
  bookmarks = bookmarks.filter(b => b.url !== url);
  saveBookmarks();
  renderBookmarks();
  renderNtpShortcuts();
  updateBookmarkBtn(activeTabId ? tabs.find(t => t.id === activeTabId)?.url : '');
}

function toggleBookmark() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab || !tab.url) return;
  if (bookmarks.some(b => b.url === tab.url)) {
    removeBookmark(tab.url);
  } else {
    addBookmark(tab.url, tab.title);
  }
}

function updateBookmarkBtn(url) {
  if (!url) { bookmarkBtn.classList.remove('bookmarked'); return; }
  bookmarkBtn.classList.toggle('bookmarked', bookmarks.some(b => b.url === url));
}

function renderBookmarks() {
  bookmarksList.innerHTML = '';
  if (bookmarks.length === 0) { bookmarksList.innerHTML = '<div class="panel-empty">No bookmarks yet</div>'; return; }
  bookmarks.forEach(b => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `<div class="hi-icon">★</div><div class="hi-info"><div class="hi-title">${escapeHtml(b.title)}</div><div class="hi-url">${escapeHtml(b.url)}</div></div>`;
    div.addEventListener('click', () => { closePanel(); navigate(b.url, activeTabId || createTab()); });
    bookmarksList.appendChild(div);
  });
}

function renderNtpShortcuts() {
  ntpShortcuts.innerHTML = '';
  const items = bookmarks.length > 0 ? bookmarks.slice(0, 8) : defaultShortcuts;
  items.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'shortcut';
    const label = s.title || s.label || s.url;
    const safeIcon = escapeHtml((label[0] || '?').toUpperCase());
    btn.innerHTML = `<div class="sc-icon">${safeIcon}</div><span class="sc-label">${escapeHtml(label)}</span>`;
    btn.addEventListener('click', () => navigate(s.url, createTab()));
    ntpShortcuts.appendChild(btn);
  });
}

// ─── Extensions ───────────────────────────────────────────
function saveExtensions() {
  try { localStorage.setItem('astarix-extensions', JSON.stringify(extensions.slice(0, 20))); } catch {}
}

function renderExtensions() {
  extensionsList.innerHTML = '';
  if (extensions.length === 0) { extensionsList.innerHTML = '<div class="panel-empty">No extensions loaded</div>'; return; }
  extensions.forEach(e => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `<div class="hi-icon">🧩</div><div class="hi-info"><div class="hi-title">${escapeHtml(e.name || 'Unknown')}</div><div class="hi-url">${escapeHtml(e.path || '')}</div></div>`;
    extensionsList.appendChild(div);
  });
}

// ─── Panel controls ───────────────────────────────────────
function openHistory() { closeMenu(); renderHistory(); historyPanel.classList.remove('hidden'); panelOverlay.classList.remove('hidden'); }
function openDownloads() { closeMenu(); renderDownloads(); downloadsPanel.classList.remove('hidden'); panelOverlay.classList.remove('hidden'); }
function openBookmarks() { closeMenu(); renderBookmarks(); bookmarksPanel.classList.remove('hidden'); panelOverlay.classList.remove('hidden'); }
function openExtensions() { closeMenu(); renderExtensions(); extensionsPanel.classList.remove('hidden'); panelOverlay.classList.remove('hidden'); }
function openAbout() { closeMenu(); aboutPanel.classList.remove('hidden'); panelOverlay.classList.remove('hidden'); }

function closePanel() {
  [historyPanel, downloadsPanel, bookmarksPanel, extensionsPanel, aboutPanel, settingsPanel].forEach(p => p.classList.add('hidden'));
  panelOverlay.classList.add('hidden');
}

document.getElementById('history-close').addEventListener('click', closePanel);
document.getElementById('downloads-close').addEventListener('click', closePanel);
document.getElementById('bookmarks-close').addEventListener('click', closePanel);
document.getElementById('extensions-close').addEventListener('click', closePanel);
document.getElementById('about-close').addEventListener('click', closePanel);
document.getElementById('settings-close').addEventListener('click', closePanel);
document.getElementById('history-clear').addEventListener('click', () => { history.length = 0; renderHistory(); });
document.getElementById('downloads-clear').addEventListener('click', () => { downloads.length = 0; renderDownloads(); });
document.getElementById('bookmarks-clear').addEventListener('click', () => { bookmarks.length = 0; saveBookmarks(); renderBookmarks(); renderNtpShortcuts(); });
panelOverlay.addEventListener('click', closePanel);

document.getElementById('ext-load-btn').addEventListener('click', async () => {
  if (!window.electronAPI?.loadExtension) return;
  if (extensions.length >= 20) return;
  const result = await window.electronAPI.loadExtension();
  if (result && result.name) {
    if (typeof result.name !== 'string' || typeof result.path !== 'string') return;
    if (result.name.length > 100 || result.path.length > 260) return;
    if (!extensions.some(e => e.path === result.path)) {
      extensions.push({ name: result.name.slice(0, 100), path: result.path.slice(0, 260) });
      saveExtensions();
      renderExtensions();
    }
  } else if (result && result.error) {
    console.log('Extension error:', result.error);
  }
});

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ─── Webview Events ───────────────────────────────────────
webview.addEventListener('dom-ready', () => {
  try { webview.setZoomFactor(settings.zoom); } catch (e) {}
});

webview.addEventListener('page-title-updated', e => {
  const tab = tabs.find(t => t.id === activeTabId);
  const safeTitle = typeof e.title === 'string' ? e.title.slice(0, 200) : '';
  if (tab) { tab.title = safeTitle; updateTabDisplay(activeTabId, safeTitle); }
});

webview.addEventListener('did-navigate', e => {
  if (e.url === 'about:blank') return;
  if (typeof e.url !== 'string' || e.url.length > 2000) return;
  if (!e.url.startsWith('http://') && !e.url.startsWith('https://')) return;
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) { tab.url = e.url.slice(0, 2000); omnibox.value = e.url.slice(0, 2000); }
  addHistory(e.url, tab?.title || e.url);
  updateBookmarkBtn(e.url);
});

webview.addEventListener('did-navigate-in-page', e => {
  if (e.url === 'about:blank' || !e.isMainFrame) return;
  if (typeof e.url !== 'string' || e.url.length > 2000) return;
  if (!e.url.startsWith('http://') && !e.url.startsWith('https://')) return;
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) { tab.url = e.url.slice(0, 2000); omnibox.value = e.url.slice(0, 2000); }
});

webview.addEventListener('did-start-loading', () => {
  navBtns.reload.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 18l8.5-6L6 6v12zm2-3.14L11.03 12 8 9.14v5.72zM16 6h2v12h-2z"/></svg>';
});

webview.addEventListener('did-fail-load', (e) => {
  if (e.errorCode !== -3) console.log('Load failed:', e.errorDescription, 'for', e.validatedURL);
});

webview.addEventListener('did-stop-loading', () => {
  navBtns.reload.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
});

webview.addEventListener('will-navigate', e => {
  if (typeof e.url !== 'string' || e.url.length > 2000 || (!e.url.startsWith('http://') && !e.url.startsWith('https://'))) e.preventDefault();
});

webview.addEventListener('new-window', e => {
  if (typeof e.url === 'string' && e.url.length <= 2000 && (e.url.startsWith('http://') || e.url.startsWith('https://'))) {
    e.preventDefault();
    navigate(e.url, createTab());
  } else {
    e.preventDefault();
  }
});

// ─── Navigation buttons ───────────────────────────────────
navBtns.back.addEventListener('click', () => { if (webview.canGoBack()) webview.goBack(); });
navBtns.fwd.addEventListener('click', () => { if (webview.canGoForward()) webview.goForward(); });
navBtns.reload.addEventListener('click', () => webview.reload());
newtabBtn.addEventListener('click', () => createTab());
bookmarkBtn.addEventListener('click', toggleBookmark);

document.getElementById('min-btn').addEventListener('click', () => window.electronAPI.minimize());
document.getElementById('max-btn').addEventListener('click', () => window.electronAPI.maximize());
document.getElementById('close-btn').addEventListener('click', () => window.electronAPI.close());

// ─── Omnibox ──────────────────────────────────────────────
omnibox.addEventListener('focus', function () {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.url) this.select();
});

omnibox.addEventListener('keydown', async e => {
  const items = suggestionsEl.querySelectorAll('.suggestion-item');
  if (e.key === 'Enter') {
    if (suggestionIdx >= 0 && items[suggestionIdx]) {
      navigate(items[suggestionIdx].dataset.url, activeTabId || createTab());
    } else {
      navigate(omnibox.value, activeTabId || createTab());
    }
    suggestionIdx = -1;
    hideSuggestions();
    omnibox.blur();
    return;
  }
  if (e.key === 'Escape') { hideSuggestions(); return; }
  if (e.key === 'ArrowDown') {
    suggestionIdx = Math.min(suggestionIdx + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle('selected', i === suggestionIdx));
    return;
  }
  if (e.key === 'ArrowUp') {
    suggestionIdx = Math.max(suggestionIdx - 1, -1);
    items.forEach((el, i) => el.classList.toggle('selected', i === suggestionIdx));
    return;
  }
  suggestionIdx = -1;
  const val = e.target.value.trim();
  clearTimeout(suggestTimer);
  if (val.length > 1) {
    suggestTimer = setTimeout(async () => {
      const sugs = await fetchSuggestions(val);
      if (omnibox.value.trim() === val) showSuggestions(val, sugs);
    }, 250);
  } else { hideSuggestions(); }
});

ntpSearch.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const val = ntpSearch.value.trim();
    if (val) { navigate(val, createTab()); ntpSearch.value = ''; }
  }
});

// ─── Suggestions ──────────────────────────────────────────
function showSuggestions(query, suggestions) {
  suggestionsEl.innerHTML = '';
  const searchUrl = buildUrl(query);
  const si = document.createElement('div');
  si.className = 'suggestion-item';
  si.dataset.url = searchUrl;
  const safeQuery = escapeHtml(query);
  si.innerHTML = `<div class="suggestion-icon search">G</div><span class="suggestion-text">Search "${safeQuery}"</span>`;
  si.addEventListener('click', () => { navigate(searchUrl, activeTabId || createTab()); hideSuggestions(); });
  suggestionsEl.appendChild(si);
  suggestions.slice(0, 5).forEach(s => {
    const url = normalizeInput(s) || buildUrl(s);
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.dataset.url = url;
    item.innerHTML = `<div class="suggestion-icon url">↗</div><span class="suggestion-text">${escapeHtml(s)}</span>`;
    item.addEventListener('click', () => { navigate(url, activeTabId || createTab()); hideSuggestions(); });
    suggestionsEl.appendChild(item);
  });
  suggestionsEl.classList.remove('hidden');
}

function hideSuggestions() {
  suggestionsEl.classList.add('hidden');
  suggestionsEl.innerHTML = '';
  suggestionIdx = -1;
}

document.addEventListener('click', e => {
  if (!e.target.closest('#omnibox-container')) hideSuggestions();
});

window.electronAPI.onOpenUrl(url => navigate(url, createTab()));

renderNtpShortcuts();
applySettings();
bindSettings();

// ─── Hamburger Menu ───────────────────────────────────────
function toggleMenu() {
  const show = hamburger.classList.contains('hidden');
  hamburger.classList.toggle('hidden', !show);
  menuOverlay.classList.toggle('hidden', !show);
}

function closeMenu() {
  hamburger.classList.add('hidden');
  menuOverlay.classList.add('hidden');
}

function applyZoom() {
  try { webview.setZoomFactor(zoomFactor); } catch (e) {}
}

menuBtn.addEventListener('click', e => { e.stopPropagation(); toggleMenu(); });
menuOverlay.addEventListener('click', closeMenu);

document.querySelectorAll('.menu-item').forEach(item => {
  item.addEventListener('click', () => {
    const action = item.dataset.action;
    closeMenu();
    switch (action) {
      case 'newtab': createTab(); break;
      case 'bookmarks': openBookmarks(); break;
      case 'history': openHistory(); break;
      case 'downloads': openDownloads(); break;
      case 'extensions': openExtensions(); break;
      case 'zoom-in': zoomFactor = Math.min(zoomFactor + 0.1, 3.0); settings.zoom = zoomFactor; saveSettings(); applyZoom(); break;
      case 'zoom-out': zoomFactor = Math.max(zoomFactor - 0.1, 0.3); settings.zoom = zoomFactor; saveSettings(); applyZoom(); break;
      case 'zoom-reset': zoomFactor = 1.0; settings.zoom = 1.0; saveSettings(); applyZoom(); break;
      case 'fullscreen': window.electronAPI.maximize(); break;
      case 'devtools': webview.focus(); window.electronAPI.openDevTools(); break;
      case 'settings': openSettings(); break;
      case 'about': openAbout(); break;
      case 'exit': window.electronAPI.close(); break;
    }
  });
});

// ─── Download IPC ─────────────────────────────────────────
if (window.electronAPI) {
  window.electronAPI.onDownloadStart((d) => {
    if (!d || typeof d.filename !== 'string' || typeof d.url !== 'string') return;
    if (d.filename.length > 200 || d.url.length > 2000) return;
    downloads.unshift({ filename: d.filename.slice(0, 100), url: d.url.slice(0, 2000), completed: false });
    if (downloads.length > 50) downloads.length = 50;
  });
  window.electronAPI.onDownloadDone((d) => {
    if (!d || typeof d.filename !== 'string') return;
    const found = downloads.find(x => x.filename === d.filename);
    if (found) found.completed = !!d.completed;
  });
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 't') { e.preventDefault(); createTab(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'w') { e.preventDefault(); if (activeTabId) closeTab(activeTabId); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'l') { e.preventDefault(); omnibox.focus(); omnibox.select(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'r') { e.preventDefault(); webview.reload(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); toggleBookmark(); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'I') { e.preventDefault(); window.electronAPI.openDevTools(); }
  if (e.key === 'F12') { e.preventDefault(); window.electronAPI.openDevTools(); }
});

if (settings.startup === 'homepage' && settings.homepage) {
  navigate(settings.homepage, createTab());
} else {
  createTab();
}
