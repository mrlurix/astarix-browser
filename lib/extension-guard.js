// ─────────────────────────────────────────────────────────────
// Extension security screening — shared by every install path
// (local folder AND Chrome Web Store). One implementation so the
// two entry points can never drift apart.
//
// Threat model: an extension runs with elevated web privileges in
// the page context. We therefore refuse anything that is broadly
// powerful, and we report what was requested so the user can see
// exactly why an install was refused.
// ─────────────────────────────────────────────────────────────

// ── Tier 1: never allowed ─────────────────────────────────────
// These let an extension escape its own sandbox or reach outside the
// browser (native code, the debugger, global traffic interception,
// reading every cookie, rewriting other extensions). We refuse them
// outright, no prompt.
const BLOCKED_PERMISSIONS = new Set([
  'nativemessaging',
  'debugger',
  'management',
  'proxy',
  'webrequestblocking',
  'webrequestauthprovider',
  'declarativenetrequest',
  'declarativenetrequestwithhostaccess',
  'browsingdata',
  'downloads',
  'privacy',
  'desktopcapture',
  'tabcapture',
  'pagecapture',
  'systemdisplay',
  'webnfc',
  'identity',
]);

// ── Tier 2: powerful but legitimate ──────────────────────────
// Common in real extensions (ad blockers, translators). They are
// allowed, but the user is told exactly what the extension wants.
const NOTABLE_PERMISSIONS = new Set([
  'cookies',
  'webrequest',
  'tabs',
  'history',
  'bookmarks',
  'bookmarksprivate',
  'topsites',
  'omnibox',
  'search',
  'sessionrestore',
  'sessions',
  'contentSettings',
  'clipboardread',
  'idle',
  'backgroundsync',
  'notifications',
  'contextMenus',
  'scripting',
  'activeTab',
  'webNavigation',
]);

// Host patterns that reach every origin.
function isBroadHost(pattern) {
  const p = String(pattern || '').trim().toLowerCase();
  if (!p) return false;
  if (p === '<all_urls>' || p === '*') return true;

  // Split "scheme://rest" and treat the pattern as broad when the host part
  // contains nothing but wildcards and slashes. This covers every spelling
  // Chrome accepts: *://*/*, *://*, http://*/*, https://*/*, file:///*,
  // file:/// , ftp://*/*, ws://*/* ... while leaving https://a.com/* alone.
  const m = p.match(/^([a-z*][a-z0-9+.*-]*):\/\/(.*)$/);
  if (!m) return false;
  const rest = m[2];
  if (!rest) return false;
  return /^[/*]+$/.test(rest);
}

function normList(v) {
  return (Array.isArray(v) ? v : []).filter(x => typeof x === 'string').map(x => x.trim().toLowerCase()).filter(Boolean);
}

// Returns one of:
//   { ok: true, ... }
//   { ok: false, reason: 'dangerous-permission' | 'broad-content-script', error }
//   { ok: true, needsConsent: true, consent: {...} }   (broad host access)
function screenManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, error: 'Invalid manifest', reason: 'invalid' };
  }

  const perms = [
    ...normList(manifest.permissions),
    ...normList(manifest.optional_permissions),
  ];
  const hostPerms = [
    ...normList(manifest.host_permissions),
    ...normList(manifest.optional_host_permissions),
  ];

  const blockedPerm = perms.find(p => BLOCKED_PERMISSIONS.has(p));
  if (blockedPerm) {
    return {
      ok: false,
      error: `This extension asks for the "${blockedPerm}" permission, which Astarix never grants because it can reach outside the browser.`,
      reason: 'dangerous-permission',
    };
  }

  // Content scripts injected everywhere are the one case we still refuse,
  // because they run on pages you cannot inspect.
  const scripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  for (const cs of scripts) {
    const matches = normList(cs && cs.matches);
    if (matches.every(isBroadHost) && matches.length) {
      return {
        ok: false,
        error: 'This extension injects its code into every website, which Astarix does not allow.',
        reason: 'broad-content-script',
      };
    }
  }

  const broadHosts = hostPerms.filter(isBroadHost);
  const specificHosts = hostPerms.filter(h => !isBroadHost(h));
  const notable = perms.filter(p => NOTABLE_PERMISSIONS.has(p));

  if (broadHosts.length) {
    return {
      ok: true,
      manifest,
      needsConsent: true,
      consent: {
        name: typeof manifest.name === 'string' ? manifest.name.slice(0, 100) : 'This extension',
        hosts: broadHosts.slice(0, 10),
        notable: notable.slice(0, 10),
      },
      allowedPermissions: perms.filter(p => !BLOCKED_PERMISSIONS.has(p)),
      allowedHosts: specificHosts,
    };
  }

  return {
    ok: true,
    manifest,
    needsConsent: notable.length > 0,
    consent: notable.length ? { notable: notable.slice(0, 10) } : null,
    allowedPermissions: perms.filter(p => !BLOCKED_PERMISSIONS.has(p)),
    allowedHosts: specificHosts,
  };
}

module.exports = { screenManifest, isBroadHost, BLOCKED_PERMISSIONS, NOTABLE_PERMISSIONS };
module.exports = { screenManifest, isBroadHost, BLOCKED_PERMISSIONS, NOTABLE_PERMISSIONS };