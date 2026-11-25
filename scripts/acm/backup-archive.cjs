/**
 * scripts/acm/backup-archive.cjs
 *
 * Zero-dependency backup archive & restore engine using Node.js built-ins (node:zlib, node:crypto).
 * Supports .zip (default, UTF-8 bit 11), .tar.gz (USTAR + PAX extended headers), and directory backups,
 * plus safe Zip-Slip-protected discovery and restoration for v2 and legacy v1 backups.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const DEFAULT_BACKUP_FORMAT = 'zip';
const DEFAULT_BACKUP_TARGET = 'local';

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || '');
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function normalizeBackupFormat(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).trim().toLowerCase();
  if (!cleaned) return null;
  if (cleaned === 'zip' || cleaned === '.zip') return 'zip';
  if (cleaned === 'tar.gz' || cleaned === '.tar.gz' || cleaned === 'tgz' || cleaned === '.tgz') {
    return 'tar.gz';
  }
  if (cleaned === 'dir' || cleaned === 'directory' || cleaned === 'folder') return 'dir';
  return null;
}

function normalizeBackupTarget(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).trim().toLowerCase();
  if (!cleaned) return null;
  if (cleaned === 'local') return 'local';
  if (cleaned === 'git') return 'git';
  if (cleaned === 'both' || cleaned === 'all' || cleaned === 'local+git' || cleaned === 'git+local') {
    return 'both';
  }
  return null;
}

function getBackupExtension(format) {
  const norm = normalizeBackupFormat(format) || DEFAULT_BACKUP_FORMAT;
  if (norm === 'zip') return '.zip';
  if (norm === 'tar.gz') return '.tar.gz';
  return '';
}

function detectBackupFormatFromPath(filePath) {
  if (!filePath) return null;
  const lower = String(filePath).toLowerCase();
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      return 'dir';
    }
  } catch (_) {}
  return null;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function computeSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normPosix(relPath) {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

function isPathInsideBase(baseDir, fullPath) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedFull = path.resolve(fullPath);
  const rel = path.relative(resolvedBase, resolvedFull);
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Recursively collects file and empty directory entries from targetDir for the given relative paths.
 * Includes hidden files and SQLite -wal / -shm companions in deterministic POSIX order.
 */
function collectEntriesFromTargets(targetDir, relTargets = []) {
  const resolvedRoot = path.resolve(targetDir);
  const collected = new Map();

  function walk(fullPath, relPosix) {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const children = fs
        .readdirSync(fullPath, { withFileTypes: true })
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      if (children.length === 0) {
        const dirKey = `${relPosix}/`;
        collected.set(dirKey, {
          name: dirKey,
          isDirectory: true,
          data: Buffer.alloc(0),
          mtime: stat.mtime,
          mode: stat.mode || 0o755,
        });
        return;
      }
      for (const child of children) {
        const childFull = path.join(fullPath, child.name);
        const childRel = relPosix ? `${relPosix}/${child.name}` : child.name;
        walk(childFull, childRel);
      }
      return;
    }

    collected.set(relPosix, {
      name: relPosix,
      isDirectory: false,
      data: fs.readFileSync(fullPath),
      mtime: stat.mtime,
      mode: stat.mode || 0o644,
    });
  }

  const sortedTargets = Array.from(new Set(relTargets.map(normPosix).filter(Boolean))).sort();
  for (const rel of sortedTargets) {
    const full = path.resolve(resolvedRoot, rel);
    if (!isPathInsideBase(resolvedRoot, full) || !fs.existsSync(full)) {
      continue;
    }
    walk(full, rel);
  }

  return Array.from(collected.values()).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
}

function toDosDateTime(dateInput) {
  const d = dateInput instanceof Date && !Number.isNaN(dateInput.getTime()) ? dateInput : new Date();
  const year = Math.max(1980, d.getFullYear());
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = Math.floor(d.getSeconds() / 2);

  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  return { dosTime, dosDate };
}

function fromDosDateTime(dosTime, dosDate) {
  const year = ((dosDate >> 9) & 0x7f) + 1980;
  const month = ((dosDate >> 5) & 0x0f) - 1;
  const day = dosDate & 0x1f;
  const hours = (dosTime >> 11) & 0x1f;
  const minutes = (dosTime >> 5) & 0x3f;
  const seconds = (dosTime & 0x1f) * 2;
  return new Date(year, Math.max(0, month), Math.max(1, day), hours, minutes, seconds);
}

/**
 * Builds an IEEE CRC-32 + DEFLATE/STORE ZIP buffer with General Purpose Bit 11 (UTF-8 filenames).
 */
function createZipBuffer(entries = []) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const isDirectory = Boolean(entry.isDirectory || String(entry.name || '').endsWith('/'));
    let entryName = String(entry.name || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (isDirectory && !entryName.endsWith('/')) {
      entryName += '/';
    }
    const nameBuf = Buffer.from(entryName, 'utf-8');
    const rawData = isDirectory
      ? Buffer.alloc(0)
      : Buffer.isBuffer(entry.data)
        ? entry.data
        : Buffer.from(entry.data || '');

    const { dosTime, dosDate } = toDosDateTime(entry.mtime);
    const uncompressedSize = rawData.length;
    const crc = isDirectory ? 0 : crc32(rawData);

    let method = 0;
    let payload = rawData;
    if (!isDirectory && rawData.length > 0) {
      const deflated = zlib.deflateRawSync(rawData, { level: 6 });
      if (deflated.length < rawData.length) {
        method = 8;
        payload = deflated;
      }
    }

    const compressedSize = payload.length;
    const flags = 0x0800; // UTF-8 filename encoding
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, payload);

    const mode = entry.mode ? entry.mode & 0o777 : isDirectory ? 0o755 : 0o644;
    const externalAttr = isDirectory
      ? (((0o040000 | mode) << 16) | 0x10) >>> 0
      : ((0o100000 | mode) << 16) >>> 0;

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(externalAttr, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

function writeBufferAtomic(destPath, buffer) {
  const resolvedDest = path.resolve(destPath);
  fs.mkdirSync(path.dirname(resolvedDest), { recursive: true });
  const tempPath = `${resolvedDest}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, resolvedDest);
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (_) {}
    }
    throw err;
  }
}

function writeZipArchive(destPath, entries) {
  const buffer = createZipBuffer(entries);
  writeBufferAtomic(destPath, buffer);
  return buffer;
}

/**
 * Parses a ZIP archive buffer, decompresses entries, and verifies CRC-32 checksums.
 */
function readZipEntries(zipBuffer) {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length < 22) {
    throw new Error('Invalid ZIP archive buffer');
  }

  const minOffset = Math.max(0, zipBuffer.length - 65557);
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= minOffset; i -= 1) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      const commentLen = zipBuffer.readUInt16LE(i + 20);
      if (i + 22 + commentLen === zipBuffer.length) {
        eocdOffset = i;
        break;
      }
    }
  }
  if (eocdOffset === -1) {
    throw new Error('ZIP End of Central Directory signature not found');
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  const results = [];
  let cursor = cdOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + 46 > zipBuffer.length || zipBuffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('Corrupt ZIP Central Directory header');
    }

    const method = zipBuffer.readUInt16LE(cursor + 10);
    const dosTime = zipBuffer.readUInt16LE(cursor + 12);
    const dosDate = zipBuffer.readUInt16LE(cursor + 14);
    const expectedCrc = zipBuffer.readUInt32LE(cursor + 16);
    const compressedSize = zipBuffer.readUInt32LE(cursor + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(cursor + 24);
    const nameLen = zipBuffer.readUInt16LE(cursor + 28);
    const extraLen = zipBuffer.readUInt16LE(cursor + 30);
    const commentLen = zipBuffer.readUInt16LE(cursor + 32);
    const localOffset = zipBuffer.readUInt32LE(cursor + 42);

    const name = zipBuffer.slice(cursor + 46, cursor + 46 + nameLen).toString('utf-8');
    cursor += 46 + nameLen + extraLen + commentLen;

    if (localOffset + 30 > zipBuffer.length || zipBuffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Corrupt ZIP Local File Header for "${name}"`);
    }
    const localNameLen = zipBuffer.readUInt16LE(localOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zipBuffer.length) {
      throw new Error(`Truncated ZIP entry data for "${name}"`);
    }

    const compressedSlice = zipBuffer.slice(dataStart, dataEnd);
    let data;
    if (method === 0) {
      data = Buffer.from(compressedSlice);
    } else if (method === 8) {
      data = zlib.inflateRawSync(compressedSlice);
    } else {
      throw new Error(`Unsupported ZIP compression method (${method}) for "${name}"`);
    }

    if (data.length !== uncompressedSize) {
      throw new Error(`ZIP size mismatch for "${name}"`);
    }
    if (crc32(data) !== expectedCrc) {
      throw new Error(`ZIP CRC-32 mismatch for "${name}"`);
    }

    const isDirectory = name.endsWith('/');
    results.push({
      name,
      isDirectory,
      data: isDirectory ? Buffer.alloc(0) : data,
      crc32: expectedCrc,
      uncompressedSize,
      mtime: fromDosDateTime(dosTime, dosDate),
    });
  }

  return results;
}

function writeOctal(buf, offset, length, value) {
  const num = Math.max(0, Math.floor(Number(value) || 0));
  const oct = num.toString(8).padStart(length - 1, '0').slice(-(length - 1));
  buf.write(`${oct}\0`, offset, length, 'ascii');
}

function buildUstarHeader({ name, mode, size, mtimeSeconds, typeflag }) {
  const header = Buffer.alloc(512, 0);
  const nameBuf = Buffer.from(String(name || ''), 'ascii').slice(0, 99);
  nameBuf.copy(header, 0);

  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, mtimeSeconds);
  header.write('        ', 148, 8, 'ascii');
  header.write(typeflag, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');

  let sum = 0;
  for (let i = 0; i < 512; i += 1) {
    sum += header[i];
  }
  const chksumStr = sum.toString(8).padStart(6, '0').slice(-6);
  header.write(`${chksumStr}\0 `, 148, 8, 'ascii');
  return header;
}

function createPaxPathPayload(utf8Path) {
  const body = ` path=${utf8Path}\n`;
  const bodyBytes = Buffer.byteLength(body, 'utf-8');
  let totalLen = bodyBytes + String(bodyBytes).length;
  while (totalLen !== bodyBytes + String(totalLen).length) {
    totalLen = bodyBytes + String(totalLen).length;
  }
  return Buffer.from(`${totalLen}${body}`, 'utf-8');
}

function toSafeAsciiFallbackName(utf8Path, isDirectory) {
  const cleaned = String(utf8Path || '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/\/+$/, '');
  const maxBase = isDirectory ? 98 : 99;
  const trimmed = cleaned.slice(0, maxBase) || 'entry';
  return isDirectory ? `${trimmed}/` : trimmed;
}

function padTarBlock(data) {
  const rem = data.length % 512;
  if (rem === 0) return data;
  return Buffer.concat([data, Buffer.alloc(512 - rem, 0)]);
}

/**
 * Builds a USTAR TAR buffer with POSIX PAX extended headers (typeflag 'x') for UTF-8 and >100 byte paths.
 */
function createTarBuffer(entries = []) {
  const chunks = [];

  for (const entry of entries) {
    const isDirectory = Boolean(entry.isDirectory || String(entry.name || '').endsWith('/'));
    let entryName = String(entry.name || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (isDirectory && !entryName.endsWith('/')) {
      entryName += '/';
    }

    const rawData = isDirectory
      ? Buffer.alloc(0)
      : Buffer.isBuffer(entry.data)
        ? entry.data
        : Buffer.from(entry.data || '');
    const mtimeDate =
      entry.mtime instanceof Date && !Number.isNaN(entry.mtime.getTime()) ? entry.mtime : new Date();
    const mtimeSec = Math.floor(mtimeDate.getTime() / 1000);
    const mode = entry.mode ? entry.mode & 0o777 : isDirectory ? 0o755 : 0o644;

    const nameByteLen = Buffer.byteLength(entryName, 'utf-8');
    const needsPax = nameByteLen > 99 || /[^\x20-\x7e]/.test(entryName);

    let headerName = entryName;
    if (needsPax) {
      const paxPayload = createPaxPathPayload(entryName);
      const fallbackBase = toSafeAsciiFallbackName(path.posix.basename(entryName.replace(/\/+$/, '')), false);
      const paxName = `PaxHeaders/${fallbackBase}`.slice(0, 99);
      chunks.push(
        buildUstarHeader({
          name: paxName,
          mode: 0o644,
          size: paxPayload.length,
          mtimeSeconds: mtimeSec,
          typeflag: 'x',
        }),
        padTarBlock(paxPayload)
      );
      headerName = toSafeAsciiFallbackName(entryName, isDirectory);
    }

    chunks.push(
      buildUstarHeader({
        name: headerName,
        mode,
        size: rawData.length,
        mtimeSeconds: mtimeSec,
        typeflag: isDirectory ? '5' : '0',
      })
    );
    if (rawData.length > 0) {
      chunks.push(padTarBlock(rawData));
    }
  }

  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

function createTarGzBuffer(entries = []) {
  return zlib.gzipSync(createTarBuffer(entries), { level: 6 });
}

function writeTarGzArchive(destPath, entries) {
  const buffer = createTarGzBuffer(entries);
  writeBufferAtomic(destPath, buffer);
  return buffer;
}

function parseTarString(buf, start, length) {
  const slice = buf.slice(start, start + length);
  const zeroIdx = slice.indexOf(0);
  const trimmed = zeroIdx === -1 ? slice : slice.slice(0, zeroIdx);
  return trimmed.toString('utf-8');
}

function parseTarOctal(buf, start, length) {
  const raw = parseTarString(buf, start, length).trim();
  if (!raw) return 0;
  return parseInt(raw, 8) || 0;
}

function parsePaxAttributes(payloadBuf) {
  const attrs = {};
  let offset = 0;
  while (offset < payloadBuf.length) {
    const spaceIdx = payloadBuf.indexOf(0x20, offset);
    if (spaceIdx === -1) break;
    const lenStr = payloadBuf.slice(offset, spaceIdx).toString('ascii');
    const recLen = parseInt(lenStr, 10);
    if (!Number.isFinite(recLen) || recLen <= 0 || offset + recLen > payloadBuf.length) {
      break;
    }
    const recordText = payloadBuf.slice(spaceIdx + 1, offset + recLen).toString('utf-8').replace(/\n$/, '');
    const eqIdx = recordText.indexOf('=');
    if (eqIdx !== -1) {
      const k = recordText.slice(0, eqIdx);
      const v = recordText.slice(eqIdx + 1);
      attrs[k] = v;
    }
    offset += recLen;
  }
  return attrs;
}

function isAllZeroBlock(block) {
  for (let i = 0; i < block.length; i += 1) {
    if (block[i] !== 0) return false;
  }
  return true;
}

/**
 * Reads and gunzips a .tar.gz buffer, applying PAX 'x' extended headers and GNU 'L' longname fallback.
 */
function readTarGzEntries(gzBuffer) {
  if (!Buffer.isBuffer(gzBuffer) || gzBuffer.length === 0) {
    throw new Error('Invalid tar.gz archive buffer');
  }
  const tarBuf = zlib.gunzipSync(gzBuffer);
  const results = [];
  let offset = 0;
  let paxAttrs = {};
  let gnuLongName = null;

  while (offset + 512 <= tarBuf.length) {
    const header = tarBuf.slice(offset, offset + 512);
    offset += 512;
    if (isAllZeroBlock(header)) {
      break;
    }

    const name = parseTarString(header, 0, 100);
    const size = parseTarOctal(header, 124, 12);
    const mtimeSec = parseTarOctal(header, 136, 12);
    const typeflag = String.fromCharCode(header[156] || 48);
    const prefix = parseTarString(header, 345, 155);

    const dataEnd = offset + size;
    if (dataEnd > tarBuf.length) {
      throw new Error(`Truncated tar entry data for "${name}"`);
    }
    const data = Buffer.from(tarBuf.slice(offset, dataEnd));
    offset += Math.ceil(size / 512) * 512;

    if (typeflag === 'x') {
      Object.assign(paxAttrs, parsePaxAttributes(data));
      continue;
    }
    if (typeflag === 'g') {
      continue;
    }
    if (typeflag === 'L') {
      gnuLongName = data.toString('utf-8').replace(/\0+$/, '');
      continue;
    }

    const rawPath = paxAttrs.path || gnuLongName || (prefix ? `${prefix}/${name}` : name);
    paxAttrs = {};
    gnuLongName = null;

    const isDirectory = typeflag === '5' || rawPath.endsWith('/');
    results.push({
      name: rawPath,
      isDirectory,
      data: isDirectory ? Buffer.alloc(0) : data,
      mtime: new Date(mtimeSec * 1000),
    });
  }

  return results;
}

function writeDirectoryBackup(destDir, targetDir, relTargets = []) {
  const entries = collectEntriesFromTargets(targetDir, relTargets);
  const resolvedDest = path.resolve(destDir);
  fs.mkdirSync(resolvedDest, { recursive: true });
  for (const entry of entries) {
    const destFull = path.resolve(resolvedDest, entry.name);
    if (!isPathInsideBase(resolvedDest, destFull)) {
      continue;
    }
    if (entry.isDirectory) {
      fs.mkdirSync(destFull, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(destFull), { recursive: true });
      fs.writeFileSync(destFull, entry.data);
    }
  }
  return entries;
}

function parseBackupTimestamp(name) {
  const m = String(name || '').match(/\.acm-backup-(\d{8})_(\d{6})(?:_(\d+))?/);
  if (!m) return 0;
  const datePart = m[1];
  const timePart = m[2];
  const suffix = Number(m[3] || 0);
  const year = Number(datePart.slice(0, 4));
  const month = Number(datePart.slice(4, 6)) - 1;
  const day = Number(datePart.slice(6, 8));
  const hour = Number(timePart.slice(0, 2));
  const min = Number(timePart.slice(2, 4));
  const sec = Number(timePart.slice(4, 6));
  return Date.UTC(year, month, day, hour, min, sec) + suffix;
}

function getDirStatsRecursive(dirPath) {
  let sizeBytes = 0;
  let count = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const sub = getDirStatsRecursive(full);
      sizeBytes += sub.sizeBytes;
      count += sub.count;
    } else {
      sizeBytes += fs.statSync(full).size;
      count += 1;
    }
  }
  return { sizeBytes, count };
}

/**
 * Discovers local .acm-backup-* archives and directories under targetDir root, sorted newest-first.
 */
function discoverLocalBackups(targetDir) {
  const resolvedRoot = path.resolve(targetDir);
  if (!fs.existsSync(resolvedRoot)) return [];

  const entries = fs.readdirSync(resolvedRoot, { withFileTypes: true });
  const backups = [];

  for (const entry of entries) {
    const name = entry.name;
    if (!name.startsWith('.acm-backup-') || name.includes('.tmp-')) {
      continue;
    }
    const fullPath = path.join(resolvedRoot, name);
    const format = entry.isDirectory() ? 'dir' : detectBackupFormatFromPath(fullPath);
    if (!format) continue;

    const stat = fs.statSync(fullPath);
    const sizeBytes = entry.isDirectory() ? getDirStatsRecursive(fullPath).sizeBytes : stat.size;
    backups.push({
      source: 'local',
      name,
      fullPath,
      format,
      sizeBytes,
      mtimeMs: stat.mtimeMs,
      createdAt: new Date(parseBackupTimestamp(name) || stat.mtimeMs).toISOString(),
    });
  }

  backups.sort((a, b) => {
    const ta = parseBackupTimestamp(a.name) || a.mtimeMs;
    const tb = parseBackupTimestamp(b.name) || b.mtimeMs;
    if (tb !== ta) return tb - ta;
    return b.name.localeCompare(a.name);
  });

  return backups;
}

function readBackupEntriesFromBuffer(buffer, format) {
  const norm = normalizeBackupFormat(format);
  if (norm === 'zip') return readZipEntries(buffer);
  if (norm === 'tar.gz') return readTarGzEntries(buffer);
  throw new Error(`Unsupported archive buffer format: ${format}`);
}

function readBackupEntriesFromPath(backupPath, format = null) {
  const resolved = path.resolve(backupPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Backup not found: ${resolved}`);
  }
  const effectiveFormat = normalizeBackupFormat(format) || detectBackupFormatFromPath(resolved);
  if (!effectiveFormat) {
    throw new Error(`Unsupported backup format: ${resolved}`);
  }
  if (effectiveFormat === 'dir') {
    const subEntries = fs.readdirSync(resolved).map((child) => child);
    return collectEntriesFromTargets(resolved, subEntries);
  }
  const buf = fs.readFileSync(resolved);
  return readBackupEntriesFromBuffer(buf, effectiveFormat);
}

/**
 * Summarizes stored config, storage provider, and v1/v2 layout from backup entries.
 */
function inspectBackupEntries(entries = []) {
  let config = null;
  let hasSqliteDb = false;
  let hasMarkdownData = false;
  let isLegacy = false;
  let fileCount = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    fileCount += 1;
    const rel = normPosix(entry.name);
    if (rel === '.agents/acm/config.json') {
      try {
        config = JSON.parse(entry.data.toString('utf-8'));
      } catch (_) {}
    } else if (rel === '.agents/config.json') {
      isLegacy = true;
      if (!config) {
        try {
          config = JSON.parse(entry.data.toString('utf-8'));
        } catch (_) {}
      }
    } else if (rel === '.agents/acm/local/memory.db' || rel === '.agents/local/memory.db') {
      hasSqliteDb = true;
      if (rel.startsWith('.agents/local/')) isLegacy = true;
    } else if (
      rel.startsWith('.agents/acm/task/') ||
      rel.startsWith('.agents/acm/memory/') ||
      rel.startsWith('.agents/task/') ||
      rel.startsWith('.agents/memory/')
    ) {
      hasMarkdownData = true;
      if (rel.startsWith('.agents/task/') || rel.startsWith('.agents/memory/')) isLegacy = true;
    } else if (rel === '.agents/MEMORY_GOVERNANCE.md') {
      isLegacy = true;
    }
  }

  let storageProvider =
    config && config.storage && typeof config.storage.provider === 'string'
      ? config.storage.provider.toLowerCase()
      : null;
  if (!storageProvider) {
    if (hasSqliteDb) storageProvider = 'sqlite';
    else if (hasMarkdownData) storageProvider = 'markdown';
  }

  return {
    config,
    storageProvider,
    hasSqliteDb,
    hasMarkdownData,
    isLegacy,
    fileCount,
  };
}

function inspectBackupBuffer(buffer, format) {
  return inspectBackupEntries(readBackupEntriesFromBuffer(buffer, format));
}

function inspectBackup(backupPath, format = null) {
  return inspectBackupEntries(readBackupEntriesFromPath(backupPath, format));
}

const V2_SKIP_RESTORE_REL = new Set([
  '.agents/acm/meta.json',
  '.agents/acm/ACM_GOVERNANCE.md',
  '.agents/acm/scripts/acm-token-monitor.cjs',
]);

/**
 * Validates archive entry paths against Zip-Slip / host path escape and maps v1/v2 data under .agents/acm/.
 */
function validateAndMapRestorePath(rawName) {
  const raw = String(rawName || '');
  if (!raw || raw.includes('\0')) {
    throw new Error(`Unsafe backup entry path (NUL/empty): "${rawName}"`);
  }
  const normalizedSlash = raw.replace(/\\/g, '/');
  if (normalizedSlash.startsWith('/') || /^[A-Za-z]:/.test(normalizedSlash)) {
    throw new Error(`Unsafe absolute path in backup entry: "${rawName}"`);
  }

  const parts = normalizedSlash.split('/');
  if (parts.some((seg) => seg === '..')) {
    throw new Error(`Unsafe parent traversal (..) in backup entry: "${rawName}"`);
  }

  const trimmed = parts.filter((seg) => seg && seg !== '.').join('/');
  const isDir = normalizedSlash.endsWith('/');
  if (!trimmed) {
    return null;
  }

  if (trimmed !== '.agents' && !trimmed.startsWith('.agents/')) {
    throw new Error(`Unsafe backup entry outside .agents/: "${rawName}"`);
  }

  if (trimmed === '.agents') {
    return null;
  }

  if (trimmed === '.agents/acm') {
    return '.agents/acm/';
  }

  if (trimmed.startsWith('.agents/acm/')) {
    if (V2_SKIP_RESTORE_REL.has(trimmed)) {
      return null;
    }
    return isDir ? `${trimmed}/` : trimmed;
  }

  // Legacy v1 -> v2 path mapping for user data and config only
  if (trimmed === '.agents/config.json') {
    return '.agents/acm/config.json';
  }
  const v1DataRoots = ['local', 'task', 'memory'];
  for (const sub of v1DataRoots) {
    const prefix = `.agents/${sub}`;
    if (trimmed === prefix) {
      return `.agents/acm/${sub}/`;
    }
    if (trimmed.startsWith(`${prefix}/`)) {
      const rest = trimmed.slice(prefix.length + 1);
      const mapped = `.agents/acm/${sub}/${rest}`;
      return isDir ? `${mapped}/` : mapped;
    }
  }

  // Skip other legacy system/IDE files cleanly (MEMORY_GOVERNANCE.md, .acm-meta.json, rules/, agents/, skills/, scripts/)
  return null;
}

/**
 * Safely validates all entries first (rejecting Zip-Slip before any disk writes),
 * cleans stale SQLite -wal/-shm files when restoring memory.db, and writes restored data under .agents/acm/.
 */
function restoreBackupEntriesToProject(targetDir, entries = []) {
  const resolvedRoot = path.resolve(targetDir);
  const acmRoot = path.resolve(resolvedRoot, '.agents', 'acm');

  // Pass 1: validate ALL paths before writing anything to disk
  const operations = [];
  let hasMemoryDb = false;
  let skippedCount = 0;

  for (const entry of entries) {
    const mapped = validateAndMapRestorePath(entry.name);
    if (!mapped) {
      skippedCount += 1;
      continue;
    }
    const cleanRel = mapped.replace(/\/+$/, '');
    const destFull = path.resolve(resolvedRoot, cleanRel);
    if (destFull !== acmRoot && !isPathInsideBase(acmRoot, destFull)) {
      throw new Error(`Unsafe mapped restore destination outside .agents/acm: "${entry.name}"`);
    }
    const isDir = Boolean(entry.isDirectory || mapped.endsWith('/'));
    if (!isDir && cleanRel === '.agents/acm/local/memory.db') {
      hasMemoryDb = true;
    }
    operations.push({
      rel: cleanRel,
      destFull,
      isDir,
      data: isDir ? Buffer.alloc(0) : Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || ''),
    });
  }

  // Pass 2: remove stale WAL/SHM files before restoring memory.db so mismatched journals cannot corrupt DB
  if (hasMemoryDb) {
    for (const sidecar of ['memory.db-wal', 'memory.db-shm']) {
      const sidecarPath = path.join(acmRoot, 'local', sidecar);
      if (fs.existsSync(sidecarPath)) {
        fs.unlinkSync(sidecarPath);
      }
    }
  }

  // Pass 3: write files & directories
  const restoredFiles = [];
  let restoredConfig = null;

  for (const op of operations) {
    if (op.isDir) {
      fs.mkdirSync(op.destFull, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(op.destFull), { recursive: true });
    let content = op.data;
    if (op.rel === '.agents/acm/config.json') {
      try {
        const parsedCfg = JSON.parse(content.toString('utf-8'));
        if (parsedCfg && parsedCfg.storage && parsedCfg.storage.dbPath === '.agents/local/memory.db') {
          parsedCfg.storage.dbPath = '.agents/acm/local/memory.db';
        }
        restoredConfig = parsedCfg;
        content = Buffer.from(JSON.stringify(parsedCfg, null, 2) + '\n', 'utf-8');
      } catch (_) {}
    }

    fs.writeFileSync(op.destFull, content);
    restoredFiles.push(op.rel);
  }

  return {
    restoredFiles,
    restoredCount: restoredFiles.length,
    skippedCount,
    restoredConfig,
  };
}

function restoreBackupBufferToProject(targetDir, buffer, format) {
  const entries = readBackupEntriesFromBuffer(buffer, format);
  return restoreBackupEntriesToProject(targetDir, entries);
}

function restoreBackupToProject(targetDir, backupPath, format = null) {
  const entries = readBackupEntriesFromPath(backupPath, format);
  return restoreBackupEntriesToProject(targetDir, entries);
}

module.exports = {
  DEFAULT_BACKUP_FORMAT,
  DEFAULT_BACKUP_TARGET,
  normalizeBackupFormat,
  normalizeBackupTarget,
  getBackupExtension,
  detectBackupFormatFromPath,
  formatBytes,
  computeSha256,
  collectEntriesFromTargets,
  crc32,
  createZipBuffer,
  writeZipArchive,
  readZipEntries,
  createTarBuffer,
  createTarGzBuffer,
  writeTarGzArchive,
  readTarGzEntries,
  writeDirectoryBackup,
  parseBackupTimestamp,
  discoverLocalBackups,
  readBackupEntriesFromBuffer,
  readBackupEntriesFromPath,
  inspectBackupEntries,
  inspectBackupBuffer,
  inspectBackup,
  validateAndMapRestorePath,
  restoreBackupEntriesToProject,
  restoreBackupBufferToProject,
  restoreBackupToProject,
};
