import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FILES_INDEX_PATH, MANIFEST_PATH, PACKAGE_LIMITS, PACKAGE_SCHEMA_VERSION } from './constants.mjs';
import { canonicalJson, decodeUtf8, parseStrictJson } from './json.mjs';
import { validateManifest } from './manifest.mjs';
import { assertNoPathCollisions, comparePackagePaths, normalizePackagePath } from './paths.mjs';
import { decodeZip, encodeDeterministicZip } from './zip.mjs';

export async function readSourceDirectory(directory) {
  const root = path.resolve(directory);
  const files = new Map();
  const paths = [];
  await walk(root, '');
  assertNoPathCollisions(paths);
  return files;

  async function walk(absolute, relative) {
    const children = await readdir(absolute, { withFileTypes: true });
    children.sort((left, right) => comparePackagePaths(left.name, right.name));
    for (const child of children) {
      const packagePath = normalizePackagePath(relative ? `${relative}/${child.name}` : child.name, { directory: child.isDirectory() });
      const childAbsolute = path.join(absolute, child.name);
      const details = await lstat(childAbsolute);
      if (details.isSymbolicLink()) throw new Error(`Source package cannot contain symlinks: ${packagePath}`);
      paths.push(packagePath);
      if (details.isDirectory()) {
        await walk(childAbsolute, packagePath.slice(0, -1));
      } else if (details.isFile()) {
        if (packagePath === FILES_INDEX_PATH) continue;
        if (files.size >= PACKAGE_LIMITS.files - 1) throw new Error('Source package contains too many files');
        if (details.size > PACKAGE_LIMITS.fileBytes) throw new Error(`Source file exceeds package limit: ${packagePath}`);
        files.set(packagePath, await readFile(childAbsolute));
      } else {
        throw new Error(`Source package contains a non-file entry: ${packagePath}`);
      }
    }
  }
}

export async function validateSourceDirectory(directory) {
  const entries = await readSourceDirectory(directory);
  const manifest = parseAndValidateManifest(entries);
  requireManifestFiles(entries, manifest);
  const index = buildFilesIndex(entries);
  return packageSummary(manifest, index, entries, null);
}

export async function packDirectory(directory) {
  const entries = await readSourceDirectory(directory);
  const manifest = parseAndValidateManifest(entries);
  requireManifestFiles(entries, manifest);
  const index = buildFilesIndex(entries);
  const archiveEntries = [...entries].map(([entryPath, data]) => ({ path: entryPath, data }));
  archiveEntries.push({ path: FILES_INDEX_PATH, data: Buffer.from(`${canonicalJson(index)}\n`) });
  const archive = encodeDeterministicZip(archiveEntries);
  return { archive, summary: packageSummary(manifest, index, entries, archive.length) };
}

export function validateWavegame(input) {
  const decoded = decodeZip(input);
  const entries = decoded.entries;
  const manifest = parseAndValidateManifest(entries);
  const rawIndex = entries.get(FILES_INDEX_PATH);
  if (!rawIndex) throw new Error(`Package is missing ${FILES_INDEX_PATH}`);
  const index = validateFilesIndex(parseStrictJson(rawIndex, FILES_INDEX_PATH));
  requireManifestFiles(entries, manifest);

  const actualPaths = [...entries.keys()].filter((entryPath) => entryPath !== FILES_INDEX_PATH).sort(comparePackagePaths);
  const indexedPaths = index.files.map((file) => file.path);
  if (actualPaths.length !== indexedPaths.length || actualPaths.some((entryPath, indexValue) => entryPath !== indexedPaths[indexValue])) {
    throw new Error('Package files do not exactly match META-INF/files.json');
  }
  for (const record of index.files) {
    const data = entries.get(record.path);
    if (!data || data.length !== record.size || sha256(data) !== record.sha256) {
      throw new Error(`Package file digest or size mismatch: ${record.path}`);
    }
  }
  return { ...packageSummary(manifest, index, entries, decoded.archiveBytes), entries };
}

export async function extractWavegame(input, targetDirectory) {
  const validated = validateWavegame(input);
  const root = path.resolve(targetDirectory);
  await mkdir(root, { recursive: true });
  for (const [entryPath, data] of validated.entries) {
    const destination = path.resolve(root, ...entryPath.split('/'));
    if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) throw new Error(`Refusing unsafe extraction target: ${entryPath}`);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, data, { flag: 'wx' });
  }
  return validated;
}

export function buildFilesIndex(entries) {
  let total = 0;
  const files = [...entries]
    .filter(([entryPath]) => entryPath !== FILES_INDEX_PATH)
    .sort(([left], [right]) => comparePackagePaths(left, right))
    .map(([entryPath, data]) => {
      total += data.length;
      if (total > PACKAGE_LIMITS.expandedBytes) throw new Error('Source package expanded size exceeds package limit');
      return { path: entryPath, size: data.length, sha256: sha256(data) };
    });
  return {
    formatVersion: PACKAGE_SCHEMA_VERSION,
    files,
  };
}

function parseAndValidateManifest(entries) {
  const rawManifest = entries.get(MANIFEST_PATH);
  if (!rawManifest) throw new Error(`Package is missing ${MANIFEST_PATH}`);
  return validateManifest(parseStrictJson(rawManifest, MANIFEST_PATH));
}

function requireManifestFiles(entries, manifest) {
  for (const entryPath of [manifest.entrypoints.rules, manifest.entrypoints.ui, manifest.icon].filter(Boolean)) {
    if (!entries.has(entryPath)) throw new Error(`Manifest references missing file: ${entryPath}`);
  }
}

function validateFilesIndex(index) {
  assertObject(index, FILES_INDEX_PATH);
  assertExactKeys(index, ['files', 'formatVersion'], FILES_INDEX_PATH);
  if (index.formatVersion !== PACKAGE_SCHEMA_VERSION) throw new Error(`${FILES_INDEX_PATH} has an unsupported formatVersion`);
  if (!Array.isArray(index.files) || index.files.length >= PACKAGE_LIMITS.files) throw new Error(`${FILES_INDEX_PATH}.files has an invalid length`);
  const paths = [];
  let previous = null;
  for (const [position, file] of index.files.entries()) {
    const label = `${FILES_INDEX_PATH}.files[${position}]`;
    assertObject(file, label);
    assertExactKeys(file, ['path', 'sha256', 'size'], label);
    file.path = normalizePackagePath(file.path);
    if (file.path === FILES_INDEX_PATH) throw new Error(`${FILES_INDEX_PATH} cannot hash itself`);
    if (!Number.isInteger(file.size) || file.size < 0 || file.size > PACKAGE_LIMITS.fileBytes) throw new Error(`${label}.size is invalid`);
    if (typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error(`${label}.sha256 is invalid`);
    if (previous !== null && comparePackagePaths(previous, file.path) >= 0) throw new Error(`${FILES_INDEX_PATH}.files must be uniquely sorted by path`);
    previous = file.path;
    paths.push(file.path);
  }
  assertNoPathCollisions(paths);
  return index;
}

export function packageIndexCanonicalBytes(index) {
  const records = index.files
    .map((file) => `{"path":${JSON.stringify(file.path)},"sha256":"${file.sha256}","size":${file.size}}`)
    .join(',');
  return Buffer.from(`{"files":[${records}],"formatVersion":${PACKAGE_SCHEMA_VERSION}}`);
}

export function packageDigest(index) {
  return sha256(packageIndexCanonicalBytes(index));
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function packageSummary(manifest, index, entries, archiveBytes) {
  return {
    id: manifest.id,
    version: manifest.version,
    title: manifest.title,
    manifest,
    packageDigest: packageDigest(index),
    files: index.files,
    fileCount: index.files.length + 1,
    expandedBytes: [...entries.values()].reduce((sum, data) => sum + data.length, 0),
    archiveBytes,
  };
}

function assertObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} has missing or unknown fields`);
}

export function prettySummary(summary) {
  return {
    id: summary.id,
    version: summary.version,
    title: summary.title,
    packageDigest: summary.packageDigest,
    fileCount: summary.fileCount,
    expandedBytes: summary.expandedBytes,
    archiveBytes: summary.archiveBytes,
    files: summary.files,
  };
}

export function sourceManifestText(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function decodeTextFile(entries, entryPath) {
  const data = entries.get(entryPath);
  if (!data) throw new Error(`Missing package file: ${entryPath}`);
  return decodeUtf8(data, entryPath);
}
