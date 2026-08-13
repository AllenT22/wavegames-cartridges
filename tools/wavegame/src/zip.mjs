import { inflateRawSync, deflateRawSync, constants as zlibConstants } from 'node:zlib';
import { PACKAGE_LIMITS } from './constants.mjs';
import { crc32 } from './crc32.mjs';
import { assertNoPathCollisions, comparePackagePaths, normalizePackagePath } from './paths.mjs';

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const DOS_DATE_1980_01_01 = 0x0021;
const decoder = new TextDecoder('utf-8', { fatal: true });

export function encodeDeterministicZip(entries, { compression = 'store' } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('ZIP requires at least one file');
  if (!['store', 'deflate'].includes(compression)) throw new Error('ZIP compression must be store or deflate');
  if (entries.length > PACKAGE_LIMITS.files) throw new Error('ZIP contains too many files');
  assertNoPathCollisions(entries.map((entry) => entry.path));

  const normalized = entries.map((entry) => {
    const path = normalizePackagePath(entry.path);
    const data = Buffer.from(entry.data);
    if (data.length > PACKAGE_LIMITS.fileBytes) throw new Error(`File exceeds package limit: ${path}`);
    const compressed = compression === 'deflate'
      ? deflateRawSync(data, { level: 9, strategy: zlibConstants.Z_DEFAULT_STRATEGY })
      : data;
    return { path, data, compressed, method: compression === 'deflate' ? 8 : 0, checksum: crc32(data) };
  }).sort((left, right) => comparePackagePaths(left.path, right.path));

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  let expandedBytes = 0;
  for (const entry of normalized) {
    expandedBytes += entry.data.length;
    if (expandedBytes > PACKAGE_LIMITS.expandedBytes) throw new Error('ZIP expanded size exceeds package limit');
    const name = Buffer.from(entry.path, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    local.writeUInt32LE(entry.checksum, 14);
    local.writeUInt32LE(entry.compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    central.writeUInt32LE(entry.checksum, 16);
    central.writeUInt32LE(entry.compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + entry.compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(normalized.length, 8);
  eocd.writeUInt16LE(normalized.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(0, 20);
  const archive = Buffer.concat([...localParts, centralDirectory, eocd]);
  if (archive.length > PACKAGE_LIMITS.archiveBytes) throw new Error('ZIP archive exceeds package limit');
  return archive;
}

export function decodeZip(input) {
  const archive = Buffer.from(input);
  if (archive.length > PACKAGE_LIMITS.archiveBytes) throw new Error('ZIP archive exceeds package limit');
  if (archive.length < 22 || archive.readUInt32LE(archive.length - 22) !== EOCD_SIGNATURE) {
    throw new Error('ZIP must have one comment-free end record at the end of the archive');
  }
  const eocd = archive.length - 22;
  const disk = archive.readUInt16LE(eocd + 4);
  const centralDisk = archive.readUInt16LE(eocd + 6);
  const diskEntries = archive.readUInt16LE(eocd + 8);
  const totalEntries = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  const commentLength = archive.readUInt16LE(eocd + 20);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) throw new Error('Multi-disk ZIP archives are not supported');
  if (commentLength !== 0 || totalEntries === 0 || totalEntries > PACKAGE_LIMITS.files) throw new Error('ZIP entry count or comment is invalid');
  if (centralOffset === 0xffffffff || centralSize === 0xffffffff || centralOffset + centralSize !== eocd) {
    throw new Error('ZIP64, prefixed, or malformed central directories are not supported');
  }

  const descriptors = [];
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    requireRange(archive, cursor, 46, 'central directory');
    if (archive.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new Error('ZIP central directory signature is invalid');
    const madeBy = archive.readUInt16LE(cursor + 4);
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const expandedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const fileCommentLength = archive.readUInt16LE(cursor + 32);
    const startDisk = archive.readUInt16LE(cursor + 34);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const recordLength = 46 + nameLength + extraLength + fileCommentLength;
    requireRange(archive, cursor, recordLength, 'central directory entry');
    if (nameLength === 0 || extraLength !== 0 || fileCommentLength !== 0 || startDisk !== 0) throw new Error('ZIP entry metadata is not supported');
    assertFlags(flags, method);
    if (![0, 8].includes(method)) throw new Error(`Unsupported ZIP compression method ${method}`);
    if ([compressedSize, expandedSize, localOffset].includes(0xffffffff)) throw new Error('ZIP64 entries are not supported');
    const path = decodeName(archive.subarray(cursor + 46, cursor + 46 + nameLength), flags);
    const directory = path.endsWith('/');
    normalizePackagePath(path, { directory });
    if (directory && (compressedSize !== 0 || expandedSize !== 0)) throw new Error(`ZIP directory contains data: ${path}`);
    const host = madeBy >>> 8;
    const mode = externalAttributes >>> 16;
    if (host === 3 && (mode & 0o170000) === 0o120000) throw new Error(`ZIP symlink is not allowed: ${path}`);
    descriptors.push({ path, directory, flags, method, checksum, compressedSize, expandedSize, localOffset });
    cursor += recordLength;
  }
  if (cursor !== centralOffset + centralSize) throw new Error('ZIP central directory size does not match its entries');
  assertNoPathCollisions(descriptors.map((entry) => entry.path));

  const entries = new Map();
  const ranges = [];
  let expandedTotal = 0;
  for (const descriptor of descriptors) {
    const offset = descriptor.localOffset;
    requireRange(archive, offset, 30, 'local ZIP header');
    if (archive.readUInt32LE(offset) !== LOCAL_SIGNATURE) throw new Error(`Missing local ZIP header for ${descriptor.path}`);
    const flags = archive.readUInt16LE(offset + 6);
    const method = archive.readUInt16LE(offset + 8);
    const checksum = archive.readUInt32LE(offset + 14);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const expandedSize = archive.readUInt32LE(offset + 22);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    requireRange(archive, offset, 30 + nameLength + extraLength + compressedSize, `local ZIP entry ${descriptor.path}`);
    const localPath = decodeName(archive.subarray(offset + 30, offset + 30 + nameLength), flags);
    if (localPath !== descriptor.path || flags !== descriptor.flags || method !== descriptor.method || checksum !== descriptor.checksum || compressedSize !== descriptor.compressedSize || expandedSize !== descriptor.expandedSize) {
      throw new Error(`Local and central ZIP metadata disagree for ${descriptor.path}`);
    }
    if (extraLength !== 0) throw new Error(`ZIP local extra fields are not supported: ${descriptor.path}`);
    if (dataEnd > centralOffset) throw new Error(`ZIP entry overlaps its central directory: ${descriptor.path}`);
    ranges.push({ start: offset, end: dataEnd, path: descriptor.path });
    if (descriptor.directory) continue;
    if (expandedSize > PACKAGE_LIMITS.fileBytes) throw new Error(`Expanded file exceeds package limit: ${descriptor.path}`);
    expandedTotal += expandedSize;
    if (expandedTotal > PACKAGE_LIMITS.expandedBytes) throw new Error('ZIP expanded size exceeds package limit');
    if (expandedSize > 1024 * 1024 && (compressedSize === 0 || expandedSize / compressedSize > PACKAGE_LIMITS.compressionRatio)) {
      throw new Error(`ZIP compression ratio is unsafe: ${descriptor.path}`);
    }
    const compressed = archive.subarray(dataStart, dataEnd);
    let data;
    try {
      data = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: expandedSize });
    } catch {
      throw new Error(`ZIP entry cannot be decompressed safely: ${descriptor.path}`);
    }
    if (method === 0 && compressedSize !== expandedSize) throw new Error(`Stored ZIP entry has inconsistent sizes: ${descriptor.path}`);
    if (data.length !== expandedSize) throw new Error(`ZIP entry expanded size is wrong: ${descriptor.path}`);
    if (crc32(data) !== checksum) throw new Error(`ZIP CRC mismatch: ${descriptor.path}`);
    entries.set(descriptor.path, data);
  }
  ranges.sort((left, right) => left.start - right.start);
  let expected = 0;
  for (const range of ranges) {
    if (range.start !== expected) throw new Error(`ZIP has overlapping, hidden, or unindexed local data near ${range.path}`);
    expected = range.end;
  }
  if (expected !== centralOffset) throw new Error('ZIP has hidden bytes before its central directory');
  return { entries, expandedBytes: expandedTotal, archiveBytes: archive.length };
}

function assertFlags(flags, method) {
  if ((flags & 0x0001) !== 0) throw new Error('Encrypted ZIP entries are not supported');
  if ((flags & 0x0008) !== 0) throw new Error('ZIP data descriptors are not supported');
  const allowed = UTF8_FLAG;
  if ((flags & ~allowed) !== 0) throw new Error(`ZIP flags 0x${flags.toString(16)} are not supported`);
}

function decodeName(bytes, flags) {
  if ((flags & UTF8_FLAG) === 0 && bytes.some((byte) => byte > 0x7f)) throw new Error('Non-ASCII ZIP names must use the UTF-8 flag');
  try {
    return decoder.decode(bytes);
  } catch {
    throw new Error('ZIP entry name is not valid UTF-8');
  }
}

function requireRange(buffer, start, length, label) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > buffer.length) {
    throw new Error(`Truncated or malformed ${label}`);
  }
}
