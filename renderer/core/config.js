// ─────────────────────────────────────────────────────────────
// Shared config, validation and safe-storage helpers.
// Single source of truth for engines, limits and persistence.
// ─────────────────────────────────────────────────────────────

function safeParseJSON(str, fallback) {
  if (str == null || str === '') return fallback;
  try { const v = JSON.parse(str); return v == null ? fallback : v; } catch (e) { return fallback; }
}

const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=', icon: 'G' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=', icon: 'B' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=', icon: 'D' },
};
const ENGINE_KEYS = Object.keys(SEARCH_ENGINES);

// Own-property lookup: blocks prototype keys like "__proto__" / "constructor".
function hasEngine(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(SEARCH_ENGINES, key);
}

const ACCENTS = {
  purple: { deep: '#6d28d9', brand: '#8b3eff', vibrant: '#a855f7', soft: '#c084fc' },
  blue: { deep: '#1e40af', brand: '#3b82f6', vibrant: '#60a5fa', soft: '#93c5fd' },
  green: { deep: '#047857', brand: '#10b981', vibrant: '#34d399', soft: '#6ee7b7' },
  red: { deep: '#b91c1c', brand: '#ef4444', vibrant: '#f87171', soft: '#fca5a5' },
  orange: { deep: '#c2410c', brand: '#f97316', vibrant: '#fb923c', soft: '#fdba74' },
  pink: { deep: '#be185d', brand: '#ec4899', vibrant: '#f472b6', soft: '#f9a8d4' },
  teal: { deep: '#0f766e', brand: '#14b8a6', vibrant: '#2dd4bf', soft: '#5eead4' },
};
const ACCENT_KEYS = Object.keys(ACCENTS);

// ── Limits (memory + DoS protection on weak devices) ─────────
const LIMITS = {
  MAX_URL: 2000,
  MAX_TITLE: 200,
  MAX_TABS: 30,
  MAX_HISTORY: 200,
  MAX_DOWNLOADS: 50,
  MAX_BOOKMARKS: 100,
  MAX_EXTENSIONS: 20,
  MAX_STORED_ARRAY: 200,
  ZOOM_MIN: 0.3,
  ZOOM_MAX: 3.0,
};

const DEFAULT_SETTINGS = {
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
  perfMode: 'auto',
};

const DEFAULT_SHORTCUTS = [
  { label: 'Google', icon: 'G', url: 'https://www.google.com' },
  { label: 'YouTube', icon: 'Y', url: 'https://www.youtube.com' },
  { label: 'GitHub', icon: 'GH', url: 'https://www.github.com' },
  { label: 'Reddit', icon: 'R', url: 'https://www.reddit.com' },
];

// ── Validators ───────────────────────────────────────────────
function isValidHttpUrl(u) {
  return typeof u === 'string' && u.length <= LIMITS.MAX_URL &&
    (u.startsWith('http://') || u.startsWith('https://'));
}

// Sanitize a settings object coming from storage or a change event.
function sanitizeSettings(raw) {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const s = Object.assign({}, DEFAULT_SETTINGS);
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (Object.prototype.hasOwnProperty.call(src, k)) s[k] = src[k];
  }
  // Legacy single-key engine migration
  if (!src.engine) {
    const legacy = localStorage.getItem('astarix-engine');
    if (hasEngine(legacy)) s.engine = legacy;
  }
  if (!hasEngine(s.engine)) s.engine = 'google';
  if (s.theme !== 'dark' && s.theme !== 'light') s.theme = 'dark';
  if (!ACCENT_KEYS.includes(s.accent)) s.accent = 'purple';
  if (s.startup !== 'newtab' && s.startup !== 'homepage') s.startup = 'newtab';
  if (!isValidHttpUrl(s.homepage)) s.homepage = DEFAULT_SETTINGS.homepage;
  if (typeof s.showShortcuts !== 'boolean') s.showShortcuts = true;
  if (typeof s.suggestions !== 'boolean') s.suggestions = true;
  if (typeof s.ntpBackground !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(s.ntpBackground)) s.ntpBackground = '';
  if (typeof s.zoom !== 'number' || !isFinite(s.zoom)) s.zoom = 1.0;
  s.zoom = Math.min(LIMITS.ZOOM_MAX, Math.max(LIMITS.ZOOM_MIN, s.zoom));
  if (typeof s.downloadsDir !== 'string' || s.downloadsDir.length > 260 || s.downloadsDir.includes('\0')) s.downloadsDir = '';
  if (s.perfMode !== 'auto' && s.perfMode !== 'on' && s.perfMode !== 'off') s.perfMode = 'auto';
  return s;
}

// Read a capped, validated array from localStorage.
function readStoredArray(key, validate, cap) {
  const v = safeParseJSON(localStorage.getItem(key), []);
  if (!Array.isArray(v)) return [];
  return v.filter(validate).slice(0, cap);
}

function writeStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

// URL detection: returns a navigable http(s) URL or null (→ search).
function normalizeInput(input) {
  if (typeof input !== 'string') return null;
  input = input.trim();
  if (!input || input.length > LIMITS.MAX_URL) return null;
  if (/[\x00-\x1f\x7f]/.test(input)) return null;
  if (/^https?:\/\//i.test(input)) {
    try { const u = new URL(input); return (u.protocol === 'http:' || u.protocol === 'https:') ? input : null; } catch (_) { return null; }
  }
  if (/^localhost(:\d+)?(\/.*)?$/i.test(input)) return 'http://' + input;
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(input)) return 'http://' + input;
  if (/^(www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(input)) return 'https://' + input;
  return null;
}

function buildUrl(input, engineKey) {
  const url = normalizeInput(input);
  if (url) return url;
  const eng = hasEngine(engineKey) ? SEARCH_ENGINES[engineKey] : SEARCH_ENGINES.google;
  return eng.url + encodeURIComponent(String(input || ''));
}

// -- Export -----------------------------------------------------

window.Astarix = window.Astarix || {};

window.Astarix.config = {
  safeParseJSON, escapeHtml,
  SEARCH_ENGINES, ENGINE_KEYS, ACCENTS, ACCENT_KEYS,
  LIMITS, DEFAULT_SETTINGS, DEFAULT_SHORTCUTS,
  isValidHttpUrl, sanitizeSettings, readStoredArray, writeStored, hasEngine,
  normalizeInput, buildUrl,
};