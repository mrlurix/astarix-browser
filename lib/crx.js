// ─────────────────────────────────────────────────────────────
// CRX parsing + safe ZIP extraction (zero dependencies).
//
// A CRX is [header][ZIP]. We locate the ZIP payload, then unpack it
// ourselves instead of shelling out, because this file is downloaded
// from the internet and must be treated as hostile input:
//   - zip-slip protection (no ../ escape, no absolute paths)
//   - no symlinks / device files
//   - hard caps on entry count, per-file size and total size
// ─────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const LIMITS = {
  MAX_CRX_BYTES: 120 * 1024 * 1024,
  MAX_ENTRIES: 5000,
  MAX_FILE_BYTES: 64 * 1024 * 1024,
  MAX_TOTAL_BYTES: 300 * 1024 * 1024,
  MAX_PATH_LENGTH: 255,
  MAX_DEPTH: 12,
};

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

// Returns { zip, version } or throws.
function parseCrx(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) throw new Error('CRX file is too small');
  if (buf.subarray(0, 4).toString('latin1') !== 'Cr24') throw new Error('Not a CRX file');

  const version = buf.readUInt32LE(4);

  if (version === 3) {
    const headerSize = buf.readUInt32LE(8);
    const zipStart = 12 + headerSize;
    if (zipStart <= 0 || zipStart >= buf.length) throw new Error('Invalid CRX header size');
    return { zip: buf.subarray(zipStart), version };
  }

  if (version === 2) {
    const publicKeyLength = buf.readUInt32LE(8);
    const signatureLength = buf.readUInt32LE(12);
    const zipStart = 16 + publicKeyLength + signatureLength;
    if (zipStart <= 0 || zipStart >= buf.length) throw new Error('Invalid CRX v2 header');
    return { zip: buf.subarray(zipStart), version };
  }

  throw new Error(`Unsupported CRX version ${version}`);
}

// Locates the end-of-central-directory record (there may be a comment
// after it, so scan backwards over a bounded window).
function findEocd(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

function readCentralDirectory(buf) {
  const eocd = findEocd(buf);
  if (eocd === -1) throw new Error('Not a ZIP file (no end-of-directory record)');

  const entryCount = buf.readUInt16LE(eocd + 10);
  const centralSize = buf.readUInt32LE(eocd + 12);
  const centralOffset = buf.readUInt32LE(eocd + 16);

  if (entryCount > LIMITS.MAX_ENTRIES) throw new Error('ZIP has too many entries');
  if (centralOffset + centralSize > buf.length) throw new Error('Corrupt ZIP central directory');

  const entries = [];
  let p = centralOffset;
  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > buf.length) throw new Error('Corrupt ZIP entry');
    if (buf.readUInt32LE(p) !== SIG_CEN) throw new Error('Corrupt ZIP central directory entry');

    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const externalAttrs = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');

    entries.push({ method, compressedSize, uncompressedSize, externalAttrs, localOffset, name });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Reject anything that could escape the destination directory.
function safeJoin(destDir, entryName) {
  if (typeof entryName !== 'string' || !entryName.length) throw new Error('ZIP entry has no name');
  if (entryName.length > LIMITS.MAX_PATH_LENGTH) throw new Error('ZIP entry path too long');
  if (entryName.includes('\0')) throw new Error('ZIP entry name contains a null byte');
  if (entryName.includes('\\')) throw new Error('ZIP entry uses backslashes');

  const normalized = path.posix.normalize(entryName);
  if (normalized.startsWith('/')) throw new Error('ZIP entry uses an absolute path');
  if (/^[a-zA-Z]:/.test(normalized)) throw new Error('ZIP entry uses a drive letter');

  const target = path.resolve(destDir, normalized);
  const root = path.resolve(destDir) + path.sep;
  if (!target.startsWith(root)) throw new Error('ZIP entry escapes the extraction directory');

  const depth = normalized.split('/').filter(Boolean).length;
  if (depth > LIMITS.MAX_DEPTH) throw new Error('ZIP entry is nested too deeply');

  return { target, normalized };
}

// Extracts a ZIP buffer into destDir. Returns { files, bytes }.
function extractZip(zipBuf, destDir) {
  const entries = readCentralDirectory(zipBuf);

  fs.mkdirSync(destDir, { recursive: true });

  let files = 0;
  let totalBytes = 0;

  for (const e of entries) {
    const name = e.name.endsWith('/') ? e.name.slice(0, -1) : e.name;
    if (!name) continue; // directory marker

    const { target } = safeJoin(destDir, name);

    // Unix mode lives in the high 16 bits of the external attributes.
    const unixMode = (e.externalAttrs >>> 16) & 0xffff;
    const isSymlink = (unixMode & 0xf000) === 0xa000;
    if (isSymlink) throw new Error('ZIP contains a symlink, which is not allowed');
    if (unixMode && (unixMode & 0xf000) && (unixMode & 0xf000) !== 0x8000 && (unixMode & 0xf000) !== 0x4000) {
      throw new Error('ZIP contains a special file, which is not allowed');
    }

    if (e.uncompressedSize > LIMITS.MAX_FILE_BYTES) throw new Error('ZIP entry is too large');
    totalBytes += e.uncompressedSize;
    if (totalBytes > LIMITS.MAX_TOTAL_BYTES) throw new Error('ZIP expands to an oversized amount of data');

    // Read the local header to find where the data actually starts.
    if (e.localOffset + 30 > zipBuf.length) throw new Error('Corrupt ZIP local header');
    if (zipBuf.readUInt32LE(e.localOffset) !== SIG_LOC) throw new Error('Corrupt ZIP local header');
    const locNameLen = zipBuf.readUInt16LE(e.localOffset + 26);
    const locExtraLen = zipBuf.readUInt16LE(e.localOffset + 28);
    const dataStart = e.localOffset + 30 + locNameLen + locExtraLen;
    const dataEnd = dataStart + e.compressedSize;
    if (dataEnd > zipBuf.length) throw new Error('Corrupt ZIP data');

    const raw = zipBuf.subarray(dataStart, dataEnd);

    let content;
    if (e.method === 0) {
      content = raw;
    } else if (e.method === 8) {
      try {
        content = zlib.inflateRawSync(raw, { maxOutputLength: LIMITS.MAX_FILE_BYTES });
      } catch (err) {
        throw new Error('ZIP entry could not be decompressed');
      }
    } else {
      throw new Error(`Unsupported ZIP compression method ${e.method}`);
    }

    if (content.length > LIMITS.MAX_FILE_BYTES) throw new Error('ZIP entry is too large');

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    files++;
    if (files > LIMITS.MAX_ENTRIES) throw new Error('ZIP has too many entries');
  }

  return { files, bytes: totalBytes };
}

module.exports = { parseCrx, extractZip, LIMITS };