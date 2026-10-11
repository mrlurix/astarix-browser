// ─────────────────────────────────────────────────────────────
// Panels & menu — open/close orchestration. Keeps exactly one
// side panel visible at a time and hides the overlay when idle.
// ─────────────────────────────────────────────────────────────

window.Astarix = window.Astarix || {};

(function (A) {
  const dom = A.dom;

  const RENDERERS = {
    history: () => A.ui.renderHistory(),
    downloads: () => A.ui.renderDownloads(),
    bookmarks: () => A.ui.renderBookmarks(),
    extensions: () => A.ui.renderExtensions(),
    settings: () => A.ui.renderSettings(),
  };

  // Rows are rebuilt from the store whenever a panel opens, so there is no
  // reason to keep them in the DOM while it is closed.
  function releasePanelContents() {
    const lists = dom.lists;
    Object.keys(lists).forEach(key => {
      const host = lists[key];
      if (host) host.textContent = '';
    });
  }

  function openPanel(name) {
    closeMenu();
    const panel = dom.panels[name];
    if (!panel) return;
    // Render lazily on open (keeps idle DOM small on weak devices).
    if (RENDERERS[name]) RENDERERS[name]();
    Object.keys(dom.panels).forEach(k => dom.panels[k].classList.add('hidden'));
    panel.classList.remove('hidden');
    dom.panelOverlay.classList.remove('hidden');
  }

  function closePanel() {
    Object.keys(dom.panels).forEach(k => dom.panels[k].classList.add('hidden'));
    dom.panelOverlay.classList.add('hidden');
    releasePanelContents();
  }

  function toggleMenu() {
    const show = dom.hamburger.classList.contains('hidden');
    dom.hamburger.classList.toggle('hidden', !show);
    dom.menuOverlay.classList.toggle('hidden', !show);
  }

  function closeMenu() {
    dom.hamburger.classList.add('hidden');
    dom.menuOverlay.classList.add('hidden');
  }

  function applyZoom() {
    try { dom.webview.setZoomFactor(A.state.store.get().zoom); } catch (_) {}
  }

  A.panels = { openPanel, closePanel, toggleMenu, closeMenu, applyZoom, releasePanelContents };
  A.applyZoom = applyZoom;
})(window.Astarix);