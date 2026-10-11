// ─────────────────────────────────────────────────────────────
// View layer — DOM element registry. Accessors are lazy (getters)
// so this module never depends on load order: every reference is
// resolved at call time, after the document is parsed.
// ─────────────────────────────────────────────────────────────

window.Astarix = window.Astarix || {};

(function (A) {
  const byId = (id) => document.getElementById(id);

  A.dom = {
    get webview() { return byId('webview'); },
    get ntp() { return byId('ntp'); },
    get ntpSearch() { return byId('ntp-search'); },
    get ntpShortcuts() { return byId('ntp-shortcuts'); },
    get ntpSectionLabel() { return byId('ntp-section-label'); },
    get omnibox() { return byId('omnibox'); },
    get suggestions() { return byId('omnibox-suggestions'); },
    get tabsBar() { return byId('tabs-bar'); },
    get hamburger() { return byId('hamburger-menu'); },
    get menuOverlay() { return byId('menu-overlay'); },
    get menuBtn() { return byId('menu-btn'); },
    get bookmarkBtn() { return byId('bookmark-btn'); },
    get newtabBtn() { return byId('newtab-btn'); },
    get panelOverlay() { return byId('panel-overlay'); },
    get navBtns() {
      return { back: byId('back-btn'), fwd: byId('fwd-btn'), reload: byId('reload-btn') };
    },
    get panels() {
      return {
        history: byId('history-panel'),
        downloads: byId('downloads-panel'),
        bookmarks: byId('bookmarks-panel'),
        extensions: byId('extensions-panel'),
        about: byId('about-panel'),
        settings: byId('settings-panel'),
      };
    },
    get lists() {
      return {
        history: byId('history-list'),
        downloads: byId('downloads-list'),
        bookmarks: byId('bookmarks-list'),
        extensions: byId('extensions-list'),
      };
    },
    get engineIndicators() { return document.querySelectorAll('.engine-indicator'); },
  };
})(window.Astarix);