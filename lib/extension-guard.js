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

// Permissions that must never be granted. Compared case-insensitively
// on the trimmed manifest value, so "NativeMessaging" cannot slip past.
const DANGEROUS_PERMISSIONS = new Set([
  'nativemessaging',
  'webrequestblocking',
  'proxy',
  'debugger',
  'management',
  'browsingdata',
  'privacy',
  'cookies',
  'downloads',
  'declarativenetrequest',
  'declarativenetrequestwithhostaccess',
  'systemdisplay',
  'webnfc',
  'backgroundsync',
  'clipboardread',
  'identity',
  'sessions',
  'topsites',
  'webnavigation',
  'tabcapture',
  'desktopcapture',
  'pagecapture',
  'bookmarks',
  'history',
  'tabstogroup',
  'tabstoungroup',
  'omnibox',
  'search',
  'bookmarksPrivate',
  'contentSettings',
  'enterprise.deviceAttributes',
  'enterprise.hardwarePlatform',
  'enterprise.networkingAttributes',
]);

// Host patterns that reach every origin on the internet.
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

// Returns { ok: true, manifest } or { ok: false, error, reason }.
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

  const blockedPerm = perms.find(p => DANGEROUS_PERMISSIONS.has(p));
  if (blockedPerm) {
    return {
      ok: false,
      error: `Extension requests the "${blockedPerm}" permission, which is blocked.`,
      reason: 'dangerous-permission',
    };
  }

  const broadHost = hostPerms.find(isBroadHost);
  if (broadHost) {
    return {
      ok: false,
      error: `Extension requests access to every site ("${broadHost}"), which is blocked.`,
      reason: 'broad-host',
    };
  }

  const scripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  for (const cs of scripts) {
    const matches = normList(cs && cs.matches);
    if (matches.some(isBroadHost)) {
      return {
        ok: false,
        error: 'Extension injects scripts into every site, which is blocked.',
        reason: 'broad-content-script',
      };
    }
  }

  // Surface what it *is* allowed to touch so the UI can show it.
  const allowedHosts = hostPerms.filter(h => !isBroadHost(h));

  return {
    ok: true,
    manifest,
    allowedPermissions: perms.filter(p => !DANGEROUS_PERMISSIONS.has(p)),
    allowedHosts,
  };
}

module.exports = { screenManifest, isBroadHost, DANGEROUS_PERMISSIONS };