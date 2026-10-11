// ─────────────────────────────────────────────────────────────
// Chrome Web Store — renderer side.
//
// This module only ever forwards an extension ID / store URL to the
// main process and renders the result. It performs no network work
// and no filesystem work of its own.
// ─────────────────────────────────────────────────────────────

window.Astarix = window.Astarix || {};

(function (A) {
  const ID_RE = /^[a-p]{32}$/;

  function setStatus(text, kind) {
    const el = document.getElementById('store-status');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('ok', 'err', 'busy');
    if (kind) el.classList.add(kind);
  }

  // Mirrors the main process rule so the user gets instant feedback,
  // but the authoritative check always happens in main.
  function looksLikeInput(value) {
    if (typeof value !== 'string') return false;
    const v = value.trim();
    if (!v) return false;
    if (ID_RE.test(v)) return true;
    return /chrome(webstore)?\.google\.com\/detail\/[^/]+\/[a-p]{32}/i.test(v);
  }

  function applyList(list) {
    if (!Array.isArray(list)) return;
    A.state.store.set({ storeExtensions: list.slice(0, 20) });
    A.ui.renderExtensions();
  }

  async function load() {
    if (!window.electronAPI?.storeList) return;
    try {
      const list = await window.electronAPI.storeList();
      applyList(list);
    } catch (_) {}
  }

  async function install(input) {
    const api = window.electronAPI;
    if (!api?.storeInstall) { setStatus('Store installation is unavailable.', 'err'); return; }

    const value = String(input || '').trim();
    if (!value) { setStatus('Enter an extension ID or a Chrome Web Store link.', 'err'); return; }
    if (!looksLikeInput(value)) {
      setStatus('That does not look like a Chrome Web Store extension ID or link.', 'err');
      return;
    }

    const btn = document.getElementById('store-install-btn');
    const inputEl = document.getElementById('store-id-input');
    if (btn) btn.disabled = true;
    setStatus('Downloading and checking the extension...', 'busy');

    try {
      const res = await api.storeInstall(value);
      if (res && res.error) {
        setStatus(res.error, 'err');
        return;
      }
      if (res && res.canceled) {
        setStatus('Installation cancelled. Nothing was installed.');
        return;
      }
      if (res && res.needsConsent) {
        setStatus('This extension needs broad access, which was not granted.', 'err');
        return;
      }
      if (res && res.installed) applyList(res.installed);
      setStatus(res && res.name ? `Installed ${res.name}.` : 'Installed.', 'ok');
      if (inputEl) inputEl.value = '';
    } catch (err) {
      setStatus('Installation failed: ' + (err && err.message ? err.message : 'unknown error'), 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function remove(id) {
    const api = window.electronAPI;
    if (!api?.storeRemove) return;
    try {
      const res = await api.storeRemove(id);
      if (res && res.installed) applyList(res.installed);
    } catch (_) {}
  }

  // Offline path: pick a .crx file from disk. Uses the exact same
  // parser and screening as a store download.
  async function installFromFile() {
    const api = window.electronAPI;
    if (!api?.storeInstallFile) { setStatus('File installation is unavailable.', 'err'); return; }

    const statusEl = document.getElementById('store-status');
    const prev = statusEl ? statusEl.textContent : '';
    setStatus('Choose a .crx file...', 'busy');

    try {
      const res = await api.storeInstallFile();
      if (!res || res.canceled) { setStatus(prev || 'Extensions are screened before they run. Broad site access and powerful permissions are blocked.'); return; }
      if (res.error) { setStatus(res.error, 'err'); return; }
      if (res.needsConsent) { setStatus('This extension needs broad access, which was not granted.', 'err'); return; }
      if (res.installed) applyList(res.installed);
      setStatus(res.name ? `Installed ${res.name} from file.` : 'Installed from file.', 'ok');
    } catch (err) {
      setStatus('Installation failed: ' + (err && err.message ? err.message : 'unknown error'), 'err');
    }
  }

  function bind() {
    const btn = document.getElementById('store-install-btn');
    const fileBtn = document.getElementById('store-file-btn');
    if (fileBtn) fileBtn.addEventListener('click', installFromFile);
    const input = document.getElementById('store-id-input');
    if (btn) btn.addEventListener('click', () => install(input ? input.value : ''));
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); install(input.value); }
      });
    }
    load();
  }

  A.store = { install, installFromFile, remove, load, bind, setStatus };
})(window.Astarix);