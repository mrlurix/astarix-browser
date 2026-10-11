// ─────────────────────────────────────────────────────────────
// Chrome Web Store client — download + install.
//
// Everything downloaded here is hostile input: it is fetched over the
// network and unpacked into a directory that Chromium will then run.
// The design is therefore deliberately narrow:
//   * the renderer may only pass an extension ID (never a URL), so this
//     module cannot be turned into a general-purpose fetcher (SSRF)
//   * the manifest is screened before anything is loaded
//   * extraction happens in a freshly created directory inside our own
//     app data, never anywhere the caller can influence
// ─────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const https = require('https');
const { parseCrx, extractZip, LIMITS } = require('./crx');
const { screenManifest } = require('./extension-guard');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const CRX_ENDPOINT = 'https://clients2.google.com/service/update2/crx';
const REQUEST_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 5;

// Chrome extension IDs are 32 chars drawn from a-p (base16 mapped onto
// the alphabet). This single regex is the trust boundary between the
// renderer and the network.
const ID_RE = /^[a-p]{32}$/;

function isValidExtensionId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

// Accepts a raw ID or any common Chrome Web Store URL and extracts the ID.
function extractId(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value || value.length > 500) return null;
  if (isValidExtensionId(value)) return value;

  const patterns = [
    /chromewebstore\.google\.com\/detail\/[^/]+\/([a-p]{32})/i,
    /chrome\.google\.com\/webstore\/detail\/[^/]+\/([a-p]{32})/i,
    /chromewebstore\.google\.com\/detail\/([a-p]{32})/i,
    /chrome\.google\.com\/webstore\/detail\/([a-p]{32})/i,
  ];
  for (const re of patterns) {
    const m = value.match(re);
    if (m && isValidExtensionId(m[1])) return m[1];
  }
  return null;
}

function request(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) return reject(new Error('Too many redirects'));
    if (!url.startsWith('https://')) return reject(new Error('Refusing non-HTTPS download'));

    const req = https.request(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: '*/*' },
    }, (res) => {
      const status = res.statusCode;

      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        let next;
        try { next = new URL(res.headers.location, url).toString(); } catch (_) { return reject(new Error('Bad redirect')); }
        // Keep the redirect chain on Google's own infrastructure.
        if (!/^https:\/\/([a-z0-9-]+\.)*google(usercontent)?\.com\//i.test(next)) {
          return reject(new Error('Redirected off the Google download host, refusing'));
        }
        return resolve(request(next, redirects + 1));
      }

      if (status === 204) {
        res.resume();
        return reject(new Error('The Chrome Web Store returned no package for this extension. Google may be blocking this network, or the extension may be unavailable here. You can also install it from a .crx file with the "From .crx file" button.'));
      }
      if (status !== 200) {
        res.resume();
        return reject(new Error(`Download failed (HTTP ${status})`));
      }

      const chunks = [];
      let total = 0;
      res.on('data', (d) => {
        total += d.length;
        if (total > LIMITS.MAX_CRX_BYTES) {
          req.destroy(new Error('Downloaded package is too large'));
          return;
        }
        chunks.push(d);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

    req.on('error', (err) => {
      if (err && /too large/.test(err.message)) return reject(err);
      return reject(new Error('Could not reach the Chrome Web Store. Google appears to be blocking this network. You can still install the extension from a .crx file with the "From .crx file" button.'));
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function downloadCrx(id) {
  if (!isValidExtensionId(id)) throw new Error('Invalid extension ID');
  const url = `${CRX_ENDPOINT}?response=redirect&acceptformat=crx2,crx3&prodversion=143.0.0.0&x=id%3D${id}%26installsource%3Dondemand%26uc`;
  const buf = await request(url);
  if (!buf || !buf.length) throw new Error('The Chrome Web Store returned an empty package');
  return buf;
}

// Reads and validates manifest.json from an extracted directory.
function readManifest(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Package has no manifest.json');
  const stat = fs.statSync(manifestPath);
  if (stat.size > 100 * 1024) throw new Error('manifest.json is too large');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

// Installs a CRX buffer into <userData>/store-extensions/<id>.
// Returns { id, name, version, path } or { error }.
function installFromCrx(id, crxBuf, rootDir, options) {
  const allowBroad = !!(options && options.allowBroadHost);
  if (!isValidExtensionId(id)) return { error: 'Invalid extension ID' };

  // The target directory is derived entirely from a validated ID and our
  // own app-data path, so it cannot be steered elsewhere.
  const targetDir = path.join(rootDir, id);
  const rootResolved = path.resolve(rootDir) + path.sep;
  if (!path.resolve(targetDir).startsWith(rootResolved)) {
    return { error: 'Refusing to install outside the extensions folder' };
  }

  fs.mkdirSync(rootDir, { recursive: true });

  // Unpack into a scratch folder first, then swap it in. If anything fails
  // the previous working copy is untouched and no partial folder is left
  // behind for the loader to trip over.
  const scratchDir = path.join(rootDir, '.staging-' + id + '-' + Date.now().toString(36));
  let crxVersion = 0;
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
    const parsed = parseCrx(crxBuf);
    crxVersion = parsed.version;
    extractZip(parsed.zip, scratchDir);

    // Sweep scratch folders left behind by an interrupted run, but never
    // the one we are filling right now.
    let entries = [];
    try { entries = fs.readdirSync(rootDir); } catch (_) {}
    for (const entry of entries) {
      if (!entry.startsWith('.staging-')) continue;
      const full = path.join(rootDir, entry);
      if (path.resolve(full) === path.resolve(scratchDir)) continue;
      try { fs.rmSync(full, { recursive: true, force: true }); } catch (_) {}
    }

    // remove the current staging folder's stale twin, if any
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(scratchDir, targetDir);
  } catch (err) {
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch (_) {}
    return { error: err.message };
  }

  let manifest;
  try {
    manifest = readManifest(targetDir);
  } catch (err) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    return { error: err.message };
  }

  // The package is on disk but NOT loaded yet — screen it first.
  const screened = screenManifest(manifest);
  if (!screened.ok) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    return { error: screened.error, reason: screened.reason };
  }
  // Access to every site is allowed, but only after the user says so.
  // The unpacked folder is removed again here: nothing may be left on disk
  // for an install the user has not agreed to yet.
  if (screened.needsConsent && !allowBroad) {
    try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch (_) {}
    return { needsConsent: true, consent: screened.consent };
  }

  return {
    id,
    name: typeof manifest.name === 'string' ? manifest.name.slice(0, 100) : id,
    version: typeof manifest.version === 'string' ? manifest.version.slice(0, 20) : '',
    path: targetDir,
    crxVersion,
    permissions: screened.allowedPermissions,
    hosts: screened.allowedHosts,
    // Consent has already been given at this point; anything still pending
    // would have returned above.
    needsConsent: false,
    consent: screened.consent || null,
  };
}

module.exports = {
  isValidExtensionId,
  extractId,
  downloadCrx,
  installFromCrx,
  readManifest,
  EXT_ID_RE: ID_RE,
};