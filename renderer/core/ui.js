// ─────────────────────────────────────────────────────────────
// View layer — pure render functions. Each one rebuilds a small
// subtree with RN primitives; nothing else in the app touches
// the DOM structure. Subscribing to the store keeps lists in
// sync with one-way data flow.
// ─────────────────────────────────────────────────────────────

window.Astarix = window.Astarix || {};

(function (A) {
  const C = A.config;
  const S = () => A.state.store;

  // ── Tabs ───────────────────────────────────────────────────
  function renderTab(tab) {
    const div = document.createElement('div');
    div.className = 'tab' + (tab.id === A.state.store.get().activeTabId ? ' active' : '');
    div.dataset.tabId = tab.id;

    const icon = document.createElement('div');
    icon.className = 'tab-icon';
    icon.textContent = (tab.title && tab.title[0] ? tab.title[0] : 'A').toUpperCase();

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || 'New Tab';

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '✕';

    div.appendChild(icon);
    div.appendChild(title);
    div.appendChild(close);
    return div;
  }

  function renderTabsBar() {
    const bar = A.dom.tabsBar;
    bar.textContent = '';
    A.state.store.get().tabs.forEach(tab => {
      const node = renderTab(tab);
      node.addEventListener('click', (e) => {
        if (!e.target.closest('.tab-close')) A.state.activateTab(tab.id);
      });
      node.querySelector('.tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        A.state.closeTab(tab.id);
      });
      bar.appendChild(node);
    });
  }

  function updateTabTitleView(tabId, title) {
    const el = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
    if (!el) return;
    const t = String(title || '').slice(0, C.LIMITS.MAX_TITLE);
    el.querySelector('.tab-title').textContent = t;
    el.querySelector('.tab-icon').textContent = (t[0] || 'A').toUpperCase();
  }

  // ── New Tab shortcuts ──────────────────────────────────────
  function renderNtpShortcuts() {
    const host = A.dom.ntpShortcuts;
    const st = A.state.store.get();
    const items = st.bookmarks.length > 0 ? st.bookmarks.slice(0, 8) : C.DEFAULT_SHORTCUTS;

    // Mount each shortcut as a direct child so the flex layout is intact.
    const frag = document.createDocumentFragment();
    items.forEach(s => {
      const label = (s.title || s.label || s.url || '?');
      const btn = document.createElement('button');
      btn.className = 'shortcut';
      btn.dataset.url = s.url;
      btn.innerHTML = '<div class="sc-icon"></div><span class="sc-label"></span>';
      btn.querySelector('.sc-icon').textContent = (label[0] || '?').toUpperCase();
      btn.querySelector('.sc-label').textContent = label.slice(0, C.LIMITS.MAX_TITLE);
      btn.addEventListener('click', () => A.state.navigate(s.url, A.state.createTab()));
      frag.appendChild(btn);
    });
    host.textContent = '';
    host.appendChild(frag);
  }

  // ── Panel list renderers (textContent = no HTML injection) ─
  function row(icon, title, subtitle, onClick) {
    const div = document.createElement('div');
    div.className = icon.rowCls || 'history-item';

    const ic = document.createElement('div');
    ic.className = icon.cls || 'hi-icon';
    ic.textContent = icon.text;

    const info = document.createElement('div');
    info.className = 'hi-info';

    const t = document.createElement('div');
    t.className = icon.titleCls || 'hi-title';
    t.textContent = title;

    const s = document.createElement('div');
    s.className = icon.subCls || 'hi-url';
    s.textContent = subtitle;

    info.appendChild(t);
    info.appendChild(s);
    div.appendChild(ic);
    div.appendChild(info);
    if (onClick) div.addEventListener('click', onClick);
    return div;
  }

  function emptyState(host, msg) {
    host.textContent = '';
    const d = document.createElement('div');
    d.className = 'panel-empty';
    d.textContent = msg;
    host.appendChild(d);
  }

  function renderHistory() {
    const host = A.dom.lists.history;
    const list = A.state.store.get().history;
    if (!list.length) return emptyState(host, 'No history yet');
    host.textContent = '';
    list.forEach(item => {
      host.appendChild(row({ text: '↗' }, item.title, item.url, () => {
        A.panels.closePanel();
        A.state.navigate(item.url, A.state.store.get().activeTabId || A.state.createTab());
      }));
    });
  }

  function renderDownloads() {
    const host = A.dom.lists.downloads;
    const list = A.state.store.get().downloads;
    if (!list.length) return emptyState(host, 'No downloads yet');
    host.textContent = '';
    list.forEach(d => {
      host.appendChild(row(
        { text: '⬇', rowCls: 'download-item', cls: 'di-icon', titleCls: 'di-name', subCls: 'di-status' },
        d.filename,
        d.completed ? 'Completed' : 'In progress...'
      ));
    });
  }

  function renderBookmarks() {
    const host = A.dom.lists.bookmarks;
    const list = A.state.store.get().bookmarks;
    if (!list.length) return emptyState(host, 'No bookmarks yet');
    host.textContent = '';
    list.forEach(b => {
      host.appendChild(row({ text: '★' }, b.title, b.url, () => {
        A.panels.closePanel();
        A.state.navigate(b.url, A.state.store.get().activeTabId || A.state.createTab());
      }));
    });
  }

  function renderExtensions() {
    const host = A.dom.lists.extensions;
    const list = A.state.store.get().extensions;
    if (!list.length) return emptyState(host, 'No extensions loaded');
    host.textContent = '';
    list.forEach(e => {
      host.appendChild(row({ text: '🧩' }, e.name, e.path));
    });
  }

  // ── Settings form sync ─────────────────────────────────────
  function renderSettings() {
    const s = A.state.store.get().settings;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const chk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    set('set-theme', s.theme);
    set('set-startup', s.startup);
    set('set-homepage', s.homepage);
    chk('set-shortcuts', s.showShortcuts);
    set('set-ntp-bg', s.ntpBackground || '#000000');
    set('set-engine', s.engine);
    chk('set-suggestions', s.suggestions);
    set('set-zoom', String(s.zoom));
    set('set-downloads', s.downloadsDir);
    set('set-perf', s.perfMode);
    document.querySelectorAll('#set-accent-row .swatch').forEach(b =>
      b.classList.toggle('active', b.dataset.accent === s.accent));
  }

  A.ui = {
    renderTabsBar, updateTabTitleView, renderNtpShortcuts,
    renderHistory, renderDownloads, renderBookmarks, renderExtensions, renderSettings,
  };
})(window.Astarix);