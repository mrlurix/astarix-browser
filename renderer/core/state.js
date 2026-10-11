// ─────────────────────────────────────────────────────────────
// State layer — the single source of truth. Every feature reads
// and writes through here (RN/Redux pattern), so behaviour is
// consistent and modules stay independent.
// ─────────────────────────────────────────────────────────────

window.Astarix = window.Astarix || {};

(function (A) {
  const C = A.config;
  const store = A.store.createStore({
    tabs: [],
    activeTabId: null,
    tabCounter: 0,
    history: [],
    downloads: [],
    bookmarks: C.readStoredArray('astarix-bookmarks',
      b => b && C.isValidHttpUrl(b.url), C.LIMITS.MAX_BOOKMARKS),
    storeExtensions: [],
    extensions: C.readStoredArray('astarix-extensions',
      e => e && typeof e.name === 'string' && typeof e.path === 'string', C.LIMITS.MAX_EXTENSIONS),
    settings: C.sanitizeSettings(C.safeParseJSON(localStorage.getItem('astarix-settings'), {})),
    engine: 'google',
    zoom: 1.0,
    suggestionIdx: -1,
  });

  // Seed engine + zoom from validated settings.
  const s0 = store.get().settings;
  store.set({ engine: s0.engine, zoom: s0.zoom });

  // ── Persistence ────────────────────────────────────────────
  function persistSettings() {
    C.writeStored('astarix-settings', store.get().settings);
  }
  function persistBookmarks() {
    C.writeStored('astarix-bookmarks', store.get().bookmarks.slice(0, C.LIMITS.MAX_BOOKMARKS));
  }
  function persistExtensions() {
    C.writeStored('astarix-extensions', store.get().extensions.slice(0, C.LIMITS.MAX_EXTENSIONS));
  }

  // ── Engine + zoom ──────────────────────────────────────────
  function setEngine(key) {
    if (!C.hasEngine(key)) return;
    store.set({ engine: key });
    localStorage.setItem('astarix-engine', key);
    const eng = C.SEARCH_ENGINES[key];
    A.dom.engineIndicators.forEach(el => { el.textContent = eng.icon; });
  }
  function cycleEngine() {
    const keys = C.ENGINE_KEYS;
    const idx = keys.indexOf(store.get().engine);
    setEngine(keys[(idx + 1) % keys.length]);
  }

  function setZoom(z) {
    if (typeof z !== 'number' || !isFinite(z)) z = 1.0;
    z = Math.min(C.LIMITS.ZOOM_MAX, Math.max(C.LIMITS.ZOOM_MIN, z));
    store.set({ zoom: z });
    A.applyZoom();
  }
  function zoomBy(delta) {
    const st = store.get();
    setZoom(delta > 0 ? Math.min(st.zoom + 0.1, C.LIMITS.ZOOM_MAX)
                      : Math.max(st.zoom - 0.1, C.LIMITS.ZOOM_MIN));
  }

  // ── Tabs ───────────────────────────────────────────────────
  function createTab(url) {
    const st = store.get();
    if (st.tabs.length >= C.LIMITS.MAX_TABS) return st.activeTabId;
    const id = ++store.get().tabCounter;
    const tab = { id, url: '', title: 'New Tab' };
    store.set({ tabCounter: id });
    store.set({ tabs: store.get().tabs.concat(tab) });
    activateTab(id);
    if (url) navigate(url, id);
    else focusNtpSearch();
    return id;
  }

  function activateTab(tabId) {
    const tab = store.get().tabs.find(t => t.id === tabId);
    if (!tab) return;
    store.set({ activeTabId: tabId });
    if (tab.url) {
      A.dom.ntp.classList.remove('active');
      A.dom.webview.classList.add('active');
      loadWebview(tab.url);
      A.dom.omnibox.value = tab.url;
      updateBookmarkBtn(tab.url);
    } else {
      A.dom.webview.classList.remove('active');
      A.dom.ntp.classList.add('active');
      A.dom.omnibox.value = '';
      A.dom.ntpSearch.value = '';
      focusNtpSearch();
      updateBookmarkBtn('');
    }
  }

  function closeTab(tabId) {
    const st = store.get();
    const idx = st.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;
    const tabs = st.tabs.filter(t => t.id !== tabId);
    store.set({ tabs });
    const el = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
    if (el) el.remove();
    if (tabs.length === 0) {
      store.set({ activeTabId: null });
      A.dom.webview.classList.remove('active');
      A.dom.ntp.classList.add('active');
      A.dom.omnibox.value = '';
      return;
    }
    if (tabId === st.activeTabId) {
      activateTab(tabs[Math.min(idx, tabs.length - 1)].id);
    }
  }

  function loadWebview(url) {
    try { A.dom.webview.loadURL(url); } catch (_) { A.dom.webview.src = url; }
  }

  function focusNtpSearch() {
    try { A.dom.ntpSearch.focus(); } catch (_) {}
  }

  // ── Navigation ─────────────────────────────────────────────
  function navigate(input, tabId) {
    const st = store.get();
    const tab = st.tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (typeof input !== 'string' || !input.length || input.length > C.LIMITS.MAX_URL) return;
    const url = C.buildUrl(input, st.engine);
    const safeTitle = input.slice(0, C.LIMITS.MAX_TITLE);
    const tabs = st.tabs.map(t => (t.id === tabId ? Object.assign({}, t, { url, title: safeTitle }) : t));
    store.set({ tabs });
    if (tabId === st.activeTabId) {
      A.dom.ntp.classList.remove('active');
      A.dom.webview.classList.add('active');
      loadWebview(url);
      A.dom.omnibox.value = url;
    }
    updateTabTitle(tabId, safeTitle);
    hideSuggestions();
  }

  function updateTabTitle(tabId, title) {
    const safe = String(title || '').slice(0, C.LIMITS.MAX_TITLE);
    store.set({ tabs: store.get().tabs.map(t => (t.id === tabId ? Object.assign({}, t, { title: safe }) : t)) });
  }

  // ── History ────────────────────────────────────────────────
  function addHistory(url, title) {
    if (!C.isValidHttpUrl(url)) return;
    if (url === 'about:blank' || url.startsWith('chrome-devtools')) return;
    const safeTitle = (typeof title === 'string' && title ? title : url).slice(0, C.LIMITS.MAX_TITLE);
    const history = [{ url: url.slice(0, C.LIMITS.MAX_URL), title: safeTitle, time: Date.now() }]
      .concat(store.get().history);
    if (history.length > C.LIMITS.MAX_HISTORY) history.length = C.LIMITS.MAX_HISTORY;
    store.set({ history });
  }

  // ── Downloads ──────────────────────────────────────────────
  function addDownload(d) {
    if (!d || typeof d.filename !== 'string' || typeof d.url !== 'string') return;
    if (d.filename.length > 200 || d.url.length > C.LIMITS.MAX_URL) return;
    const downloads = [{ filename: d.filename.slice(0, 100), url: d.url.slice(0, C.LIMITS.MAX_URL), completed: false }]
      .concat(store.get().downloads);
    if (downloads.length > C.LIMITS.MAX_DOWNLOADS) downloads.length = C.LIMITS.MAX_DOWNLOADS;
    store.set({ downloads });
  }

  function completeDownload(d) {
    if (!d || typeof d.filename !== 'string') return;
    store.set({ downloads: store.get().downloads.map(x =>
      x.filename === d.filename ? Object.assign({}, x, { completed: !!d.completed }) : x) });
  }

  // ── Bookmarks ──────────────────────────────────────────────
  function addBookmark(url, title) {
    if (!C.isValidHttpUrl(url)) return;
    const st = store.get();
    if (st.bookmarks.some(b => b.url === url)) return;
    if (st.bookmarks.length >= C.LIMITS.MAX_BOOKMARKS) return;
    const safeTitle = (typeof title === 'string' && title ? title : url).slice(0, C.LIMITS.MAX_TITLE);
    const bookmarks = [{ url, title: safeTitle, time: Date.now() }].concat(st.bookmarks);
    store.set({ bookmarks });
    persistBookmarks();
    updateBookmarkBtn(url);
  }

  function removeBookmark(url) {
    store.set({ bookmarks: store.get().bookmarks.filter(b => b.url !== url) });
    persistBookmarks();
    const st = store.get();
    updateBookmarkBtn(st.activeTabId ? (st.tabs.find(t => t.id === st.activeTabId) || {}).url : '');
  }

  function toggleBookmark() {
    const st = store.get();
    const tab = st.tabs.find(t => t.id === st.activeTabId);
    if (!tab || !tab.url) return;
    if (st.bookmarks.some(b => b.url === tab.url)) removeBookmark(tab.url);
    else addBookmark(tab.url, tab.title);
  }

  function isBookmarked(url) {
    return !!url && store.get().bookmarks.some(b => b.url === url);
  }

  function updateBookmarkBtn(url) {
    A.dom.bookmarkBtn.classList.toggle('bookmarked', isBookmarked(url));
  }

  // ── Extensions ─────────────────────────────────────────────
  function addExtension(name, path) {
    if (typeof name !== 'string' || typeof path !== 'string') return;
    if (name.length > 100 || path.length > 260) return;
    const st = store.get();
    if (st.extensions.some(e => e.path === path)) return;
    if (st.extensions.length >= C.LIMITS.MAX_EXTENSIONS) return;
    store.set({ extensions: st.extensions.concat({ name: name.slice(0, 100), path: path.slice(0, 260) }) });
    persistExtensions();
  }

  // ── Settings ───────────────────────────────────────────────
  function updateSettings(partial) {
    const next = C.sanitizeSettings(Object.assign({}, store.get().settings, partial));
    store.set({ settings: next });
    persistSettings();
    applySettings();
    // Always resync the form: sanitization may have replaced a value, so the
    // controls must never drift from the stored state. This is a handful of
    // property writes on existing nodes, so it stays cheap.
    if (A.ui && A.ui.renderSettings) A.ui.renderSettings();
  }

  function resetSettings() {
    const next = C.sanitizeSettings(Object.assign({}, C.DEFAULT_SETTINGS));
    store.set({ settings: next });
    persistSettings();
    applySettings();
    if (A.ui && A.ui.renderSettings) A.ui.renderSettings();
  }

  function applySettings() {
    const st = store.get();
    const s = st.settings;
    document.body.classList.toggle('light', s.theme === 'light');
    applyPerfMode(s.perfMode);
    const a = C.ACCENTS[s.accent] || C.ACCENTS.purple;
    const root = document.documentElement.style;
    root.setProperty('--purple-deep', a.deep);
    root.setProperty('--purple-brand', a.brand);
    root.setProperty('--purple-vibrant', a.vibrant);
    root.setProperty('--purple-soft', a.soft);
    root.setProperty('--purple-subtle', hexToRgba(a.brand, 0.12));
    setEngine(s.engine);
    setZoom(s.zoom);
    A.dom.ntp.style.background = s.ntpBackground || '';
    const scHidden = !s.showShortcuts;
    A.dom.ntpSectionLabel.classList.toggle('hidden', scHidden);
    A.dom.ntpShortcuts.classList.toggle('hidden', scHidden);
    if (window.electronAPI?.setDownloadsFolder && s.downloadsDir) {
      window.electronAPI.setDownloadsFolder(s.downloadsDir);
    }
  }

  // Performance mode: strips animations, blur and shadows for weak GPUs.
  // "auto" turns it on when the machine reports few CPU cores or little memory.
  function perfModeActive(mode) {
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    const cores = navigator.hardwareConcurrency || 2;
    const mem = navigator.deviceMemory || 4;
    return cores <= 2 || mem <= 2;
  }

  // Explains the current mode so the settings panel can tell the user
  // whether it is actually running, and why.
  function perfModeInfo() {
    const cores = navigator.hardwareConcurrency || 2;
    const mem = navigator.deviceMemory || 4;
    const low = cores <= 2 || mem <= 2;
    const active = perfModeActive(store.get().settings.perfMode);
    return { active, cores, mem, low, mode: store.get().settings.perfMode };
  }

  function applyPerfMode(mode) {
    document.body.classList.toggle('perf-lite', perfModeActive(mode));
    renderPerfBadge();
  }

  // A visible marker, because with animations and blur removed the change
  // is otherwise easy to miss.
  function renderPerfBadge() {
    const body = document.body;
    let badge = document.getElementById('perf-badge');
    if (!body.classList.contains('perf-lite')) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'perf-badge';
      badge.textContent = 'Lite mode';
      badge.title = 'Animations, blur and shadows are disabled to reduce CPU and GPU usage.';
      document.body.appendChild(badge);
    }
  }
  function hexToRgba(hex, alpha) {
    const h = String(hex || '').replace('#', '');
    const n = parseInt(h, 16);
    if (!isFinite(n) || h.length !== 6) return `rgba(139, 62, 255, ${alpha})`;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  // ── Suggestions ────────────────────────────────────────────
  let suggestTimer = null;
  function scheduleSuggestions(query, onResult) {
    clearTimeout(suggestTimer);
    const st = store.get();
    if (!st.settings.suggestions) { onResult([]); return; }
    if (typeof query !== 'string' || query.length < 2 || query.length > 200) { onResult([]); return; }
    suggestTimer = setTimeout(async () => {
      const list = await fetchSuggestions(query);
      if (store.get().settings.suggestions) onResult(list);
    }, 250);
  }

  async function fetchSuggestions(query) {
    if (!store.get().settings.suggestions) return [];
    if (typeof query !== 'string' || query.length > 200) return [];
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) return [];
      const data = await r.json();
      const arr = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
      return arr.slice(0, 8).filter(x => typeof x === 'string' && x.length <= 200);
    } catch (_) { return []; }
  }

  function showSuggestions(query, suggestions) {
    const box = A.dom.suggestions;
    box.textContent = '';
    const st = store.get();
    const searchUrl = C.buildUrl(query, st.engine);

    const mk = (cls, text, url) => {
      const item = document.createElement('div');
      item.className = 'suggestion-item' + (cls ? ' ' + cls : '');
      item.dataset.url = url;
      const icon = document.createElement('div');
      icon.className = 'suggestion-icon ' + (cls === 'search' ? 'search' : 'url');
      icon.textContent = cls === 'search' ? st.engine.slice(0, 1).toUpperCase() : '↗';
      const span = document.createElement('span');
      span.className = 'suggestion-text';
      span.textContent = text;
      item.appendChild(icon);
      item.appendChild(span);
      item.addEventListener('click', () => { navigate(url, st.activeTabId || createTab()); hideSuggestions(); });
      return item;
    };

    box.appendChild(mk('search', `Search "${query}"`, searchUrl));
    suggestions.slice(0, 5).forEach(s => {
      const url = C.normalizeInput(s) || C.buildUrl(s, st.engine);
      box.appendChild(mk(null, s, url));
    });
    store.set({ suggestionIdx: -1 });
    box.classList.remove('hidden');
  }

  function hideSuggestions() {
    store.set({ suggestionIdx: -1 });
    A.dom.suggestions.classList.add('hidden');
    A.dom.suggestions.textContent = '';
  }

  function highlightSuggestion(idx) {
    const items = A.dom.suggestions.querySelectorAll('.suggestion-item');
    if (!items.length) return;
    const clamped = Math.max(-1, Math.min(idx, items.length - 1));
    store.set({ suggestionIdx: clamped });
    items.forEach((el, i) => el.classList.toggle('selected', i === clamped));
  }

  function selectedSuggestion() {
    const st = store.get();
    if (st.suggestionIdx < 0) return null;
    const items = A.dom.suggestions.querySelectorAll('.suggestion-item');
    const el = items[st.suggestionIdx];
    return el ? el.dataset.url : null;
  }

  A.state = {
    store, persistSettings, persistBookmarks, persistExtensions,
    setEngine, cycleEngine, setZoom, zoomBy,
    createTab, activateTab, closeTab, navigate, updateTabTitle,
    addHistory, addDownload, completeDownload,
    addBookmark, removeBookmark, toggleBookmark, isBookmarked, updateBookmarkBtn,
    addExtension, updateSettings, resetSettings, applySettings, applyPerfMode, perfModeActive, perfModeInfo, renderPerfBadge,
    scheduleSuggestions, showSuggestions, hideSuggestions, highlightSuggestion, selectedSuggestion,
    hexToRgba,
  };
})(window.Astarix);