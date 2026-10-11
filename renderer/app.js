// ─────────────────────────────────────────────────────────────
// App bootstrap — wiring only. All logic lives in core modules:
//   core/rn.js       RN-style primitives (View/Text/Pressable)
//   core/store.js    reactive store + emitter (batched notify)
//   core/config.js   engines, accents, limits, validation
//   core/dom.js      element registry
//   core/state.js    single source of truth + actions
//   core/ui.js       pure render functions
//   core/panels.js   panel/menu orchestration
// ─────────────────────────────────────────────────────────────

(function (A) {
  const { dom, state, ui, panels } = A;
  const C = A.config;

  // ── Webview events → state ─────────────────────────────────
  dom.webview.addEventListener('dom-ready', () => panels.applyZoom());

  dom.webview.addEventListener('page-title-updated', (e) => {
    const st = state.store.get();
    if (st.activeTabId != null) {
      const safe = typeof e.title === 'string' ? e.title.slice(0, C.LIMITS.MAX_TITLE) : '';
      state.updateTabTitle(st.activeTabId, safe);
      ui.updateTabTitleView(st.activeTabId, safe);
    }
  });

  dom.webview.addEventListener('did-navigate', (e) => {
    if (e.url === 'about:blank') return;
    if (!C.isValidHttpUrl(e.url)) return;
    const st = state.store.get();
    if (st.activeTabId != null) {
      state.updateTabTitle(st.activeTabId, st.tabs.find(t => t.id === st.activeTabId)?.title || e.url);
      const tabs = st.tabs.map(t => (t.id === st.activeTabId ? Object.assign({}, t, { url: e.url }) : t));
      state.store.set({ tabs });
      dom.omnibox.value = e.url;
    }
    state.addHistory(e.url, st.tabs.find(t => t.id === st.activeTabId)?.title);
    state.updateBookmarkBtn(e.url);
  });

  dom.webview.addEventListener('did-navigate-in-page', (e) => {
    if (e.url === 'about:blank' || !e.isMainFrame) return;
    if (!C.isValidHttpUrl(e.url)) return;
    const st = state.store.get();
    if (st.activeTabId == null) return;
    state.store.set({ tabs: st.tabs.map(t => (t.id === st.activeTabId ? Object.assign({}, t, { url: e.url }) : t)) });
    dom.omnibox.value = e.url;
  });

  const RELOAD_ICON = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
  const STOP_ICON = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 18l8.5-6L6 6v12zm2-3.14L11.03 12 8 9.14v5.72zM16 6h2v12h-2z"/></svg>';

  dom.webview.addEventListener('did-start-loading', () => { dom.navBtns.reload.innerHTML = STOP_ICON; });
  dom.webview.addEventListener('did-stop-loading', () => { dom.navBtns.reload.innerHTML = RELOAD_ICON; });

  dom.webview.addEventListener('did-fail-load', (e) => {
    if (e.errorCode !== -3) console.log('Load failed:', e.errorDescription, 'for', e.validatedURL);
  });

  dom.webview.addEventListener('will-navigate', (e) => {
    if (!C.isValidHttpUrl(e.url)) e.preventDefault();
  });

  dom.webview.addEventListener('new-window', (e) => {
    e.preventDefault();
    if (C.isValidHttpUrl(e.url)) state.navigate(e.url, state.createTab());
  });

  // ── Navigation buttons ─────────────────────────────────────
  dom.navBtns.back.addEventListener('click', () => { if (dom.webview.canGoBack()) dom.webview.goBack(); });
  dom.navBtns.fwd.addEventListener('click', () => { if (dom.webview.canGoForward()) dom.webview.goForward(); });
  dom.navBtns.reload.addEventListener('click', () => dom.webview.reload());
  dom.newtabBtn.addEventListener('click', () => state.createTab());
  dom.bookmarkBtn.addEventListener('click', () => state.toggleBookmark());

  document.getElementById('min-btn').addEventListener('click', () => window.electronAPI.minimize());
  document.getElementById('max-btn').addEventListener('click', () => window.electronAPI.maximize());
  document.getElementById('close-btn').addEventListener('click', () => window.electronAPI.close());

  // ── Omnibox ────────────────────────────────────────────────
  dom.omnibox.addEventListener('focus', function () {
    const st = state.store.get();
    const tab = st.tabs.find(t => t.id === st.activeTabId);
    if (tab && tab.url) this.select();
  });

  dom.omnibox.addEventListener('keydown', (e) => {
    const st = state.store.get();
    if (e.key === 'Enter') {
      const picked = state.selectedSuggestion();
      state.navigate(picked || dom.omnibox.value, st.activeTabId || state.createTab());
      state.hideSuggestions();
      dom.omnibox.blur();
      return;
    }
    if (e.key === 'Escape') { state.hideSuggestions(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.highlightSuggestion(st.suggestionIdx + 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.highlightSuggestion(st.suggestionIdx - 1);
      return;
    }
    const val = e.target.value.trim();
    if (val.length > 1) {
      state.scheduleSuggestions(val, (list) => {
        if (dom.omnibox.value.trim() === val) state.showSuggestions(val, list);
        else state.hideSuggestions();
      });
    } else {
      state.hideSuggestions();
    }
  });

  dom.ntpSearch.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const val = dom.ntpSearch.value.trim();
    if (!val) return;
    const st = state.store.get();
    state.navigate(val, st.activeTabId || state.createTab());
    dom.ntpSearch.value = '';
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#omnibox-container')) state.hideSuggestions();
  });

  // ── Engine cycling ─────────────────────────────────────────
  dom.engineIndicators.forEach(el => el.addEventListener('click', () => state.cycleEngine()));

  // ── Panels ─────────────────────────────────────────────────
  ['history', 'downloads', 'bookmarks', 'extensions', 'about', 'settings'].forEach(name => {
    const closeBtn = document.getElementById(name + '-close');
    if (closeBtn) closeBtn.addEventListener('click', () => panels.closePanel());
  });
  dom.panelOverlay.addEventListener('click', () => panels.closePanel());

  document.getElementById('history-clear').addEventListener('click', () => {
    state.store.set({ history: [] });
    ui.renderHistory();
  });
  document.getElementById('downloads-clear').addEventListener('click', () => {
    state.store.set({ downloads: [] });
    ui.renderDownloads();
  });
  document.getElementById('bookmarks-clear').addEventListener('click', () => {
    state.store.set({ bookmarks: [] });
    state.persistBookmarks();
    ui.renderBookmarks();
    ui.renderNtpShortcuts();
  });

  document.getElementById('ext-load-btn').addEventListener('click', async () => {
    if (!window.electronAPI?.loadExtension) return;
    const result = await window.electronAPI.loadExtension();
    if (result && result.name) {
      state.addExtension(result.name, result.path);
      ui.renderExtensions();
    } else if (result && result.error) {
      console.log('Extension error:', result.error);
    }
  });

  // ── Settings bindings ──────────────────────────────────────
  const on = (id, evt, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(evt, fn);
  };

  on('set-theme', 'change', (e) => {
    if (e.target.value === 'dark' || e.target.value === 'light') state.updateSettings({ theme: e.target.value });
  });
  on('set-startup', 'change', (e) => {
    if (e.target.value === 'newtab' || e.target.value === 'homepage') state.updateSettings({ startup: e.target.value });
  });
  on('set-homepage', 'change', (e) => {
    const v = e.target.value.trim().slice(0, 500);
    if (v && !C.isValidHttpUrl(C.normalizeInput(v))) return;
    state.updateSettings({ homepage: v || C.DEFAULT_SETTINGS.homepage });
  });
  on('set-shortcuts', 'change', (e) => {
    state.updateSettings({ showShortcuts: !!e.target.checked });
    ui.renderNtpShortcuts();
  });
  on('set-ntp-bg', 'change', (e) => {
    if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) state.updateSettings({ ntpBackground: e.target.value });
  });
  on('set-engine', 'change', (e) => {
    if (C.hasEngine(e.target.value)) state.updateSettings({ engine: e.target.value });
  });
  on('set-suggestions', 'change', (e) => state.updateSettings({ suggestions: !!e.target.checked }));
  on('set-zoom', 'change', (e) => {
    state.updateSettings({ zoom: parseFloat(e.target.value) });
    state.setZoom(state.store.get().settings.zoom);
  });
  on('set-perf', 'change', (e) => {
    const v = e.target.value;
    if (v === 'auto' || v === 'on' || v === 'off') state.updateSettings({ perfMode: v });
  });
  on('set-downloads', 'change', (e) => {
    const v = e.target.value.trim().slice(0, 260);
    if (v.includes('\0')) return;
    state.updateSettings({ downloadsDir: v });
    if (window.electronAPI?.setDownloadsFolder) window.electronAPI.setDownloadsFolder(v);
  });
  document.querySelectorAll('#set-accent-row .swatch').forEach(b => {
    b.addEventListener('click', () => {
      state.updateSettings({ accent: b.dataset.accent });
      ui.renderSettings();
    });
  });
  on('set-reset', 'click', () => {
    state.resetSettings();
    ui.renderSettings();
    ui.renderNtpShortcuts();
  });

  // ── Hamburger menu ─────────────────────────────────────────
  dom.menuBtn.addEventListener('click', (e) => { e.stopPropagation(); panels.toggleMenu(); });
  dom.menuOverlay.addEventListener('click', () => panels.closeMenu());

  const MENU_ACTIONS = {
    newtab: () => state.createTab(),
    bookmarks: () => panels.openPanel('bookmarks'),
    history: () => panels.openPanel('history'),
    downloads: () => panels.openPanel('downloads'),
    extensions: () => panels.openPanel('extensions'),
    'zoom-in': () => state.zoomBy(1),
    'zoom-out': () => state.zoomBy(-1),
    'zoom-reset': () => state.setZoom(1.0),
    fullscreen: () => window.electronAPI.maximize(),
    devtools: () => { dom.webview.focus(); window.electronAPI.openDevTools(); },
    settings: () => panels.openPanel('settings'),
    about: () => panels.openPanel('about'),
    exit: () => window.electronAPI.close(),
  };

  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      panels.closeMenu();
      const fn = MENU_ACTIONS[action];
      if (fn) fn();
    });
  });

  // ── IPC subscriptions ──────────────────────────────────────
  if (window.electronAPI) {
    window.electronAPI.onOpenUrl(url => {
      if (C.isValidHttpUrl(url)) state.navigate(url, state.createTab());
    });
    window.electronAPI.onDownloadStart(d => {
      state.addDownload(d);
      if (!dom.panels.downloads.classList.contains('hidden')) ui.renderDownloads();
    });
    window.electronAPI.onDownloadDone(d => {
      state.completeDownload(d);
      if (!dom.panels.downloads.classList.contains('hidden')) ui.renderDownloads();
    });
  }

  // ── Keyboard shortcuts ─────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 't') { e.preventDefault(); state.createTab(); }
    else if (ctrl && e.key === 'w') { e.preventDefault(); if (state.store.get().activeTabId) state.closeTab(state.store.get().activeTabId); }
    else if (ctrl && e.key === 'l') { e.preventDefault(); dom.omnibox.focus(); dom.omnibox.select(); }
    else if (ctrl && e.key === 'r') { e.preventDefault(); dom.webview.reload(); }
    else if (ctrl && e.key === 'd') { e.preventDefault(); state.toggleBookmark(); }
    else if (ctrl && e.shiftKey && (e.key === 'I' || e.key === 'i')) { e.preventDefault(); window.electronAPI.openDevTools(); }
    else if (e.key === 'F12') { e.preventDefault(); window.electronAPI.openDevTools(); }
  });

  // ── Boot ───────────────────────────────────────────────────
  ui.renderNtpShortcuts();
  state.applySettings();

  // Render tabs reactively (one-way data flow).
  let lastTabsSig = '';
  state.store.subscribe((st) => {
    const sig = st.tabs.map(t => `${t.id}:${t.title}`).join('|') + '#' + st.activeTabId;
    if (sig !== lastTabsSig) {
      lastTabsSig = sig;
      ui.renderTabsBar();
    }
  });

  const bootSettings = state.store.get().settings;
  if (bootSettings.startup === 'homepage' && bootSettings.homepage) {
    state.navigate(bootSettings.homepage, state.createTab());
  } else {
    state.createTab();
  }
  // The boot tab is created before the subscriber's microtask runs,
  // so paint it explicitly to avoid an empty tab bar.
  ui.renderTabsBar();
})(window.Astarix);