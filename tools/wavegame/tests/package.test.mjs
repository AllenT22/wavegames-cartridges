import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createCartridge } from '../src/scaffold.mjs';
import {
  extractWavegame,
  packDirectory,
  packageDigest,
  packageIndexCanonicalBytes,
  validateWavegame,
} from '../src/package.mjs';
import { parseStrictJson } from '../src/json.mjs';
import { decodeZip, encodeDeterministicZip } from '../src/zip.mjs';
import { temporaryDirectory } from './helpers.mjs';

test('package-index canonical bytes and digest match the Dart golden', async () => {
  const indexBytes = await readFile(new URL('../testdata/package-index-v1.json', import.meta.url));
  const expected = (await readFile(new URL('../testdata/package-index-v1.sha256', import.meta.url), 'utf8')).trim();
  const index = parseStrictJson(indexBytes, 'golden index');
  assert.deepEqual(packageIndexCanonicalBytes(index), Buffer.from(indexBytes.toString('utf8').trim()));
  assert.equal(packageDigest(index), expected);
  assert.equal(createHash('sha256').update(packageIndexCanonicalBytes(index)).digest('hex'), expected);
});

test('packing is deterministic and produces a fully indexed valid archive', async (context) => {
  const temporary = await temporaryDirectory();
  context.after(temporary.cleanup);
  const source = temporary.resolve('source');
  await createCartridge(source, { id: 'games.example.deterministic', title: 'Deterministic' });
  const first = await packDirectory(source);
  const second = await packDirectory(source);
  assert.deepEqual(first.archive, second.archive);
  const validated = validateWavegame(first.archive);
  assert.equal(validated.id, 'games.example.deterministic');
  assert.equal(validated.files.some((file) => file.path === 'wavegame.json'), true);
  assert.equal(validated.files.some((file) => file.path === 'META-INF/files.json'), false);
  assert.equal(validated.packageDigest, first.summary.packageDigest);
  const extracted = temporary.resolve('extracted');
  await extractWavegame(first.archive, extracted);
  assert.equal((await readFile(`${extracted}/wavegame.json`, 'utf8')).includes('games.example.deterministic'), true);
});

test('ZIP validation rejects CRC tampering, encryption, symlinks, and unsafe paths', async (context) => {
  const temporary = await temporaryDirectory();
  context.after(temporary.cleanup);
  const source = temporary.resolve('source');
  await createCartridge(source);
  const { archive } = await packDirectory(source);

  const crcTampered = Buffer.from(archive);
  const firstData = localDataStart(crcTampered, 0);
  crcTampered[firstData] ^= 0xff;
  assert.throws(() => decodeZip(crcTampered), /CRC mismatch/);

  const encrypted = Buffer.from(archive);
  encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 1, 6);
  const central = centralOffset(encrypted);
  encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
  assert.throws(() => decodeZip(encrypted), /Encrypted/);

  const symlink = Buffer.from(archive);
  symlink.writeUInt32LE((0o120777 << 16) >>> 0, centralOffset(symlink) + 38);
  assert.throws(() => decodeZip(symlink), /symlink/);

  const safe = encodeDeterministicZip([{ path: 'safe', data: Buffer.from('x') }]);
  const traversal = Buffer.from(safe);
  Buffer.from('../x').copy(traversal, 30);
  Buffer.from('../x').copy(traversal, centralOffset(traversal) + 46);
  assert.throws(() => decodeZip(traversal), /unsafe segment/);
});

test('ZIP validation rejects collisions, hidden data, unsupported metadata, and bombs', () => {
  assert.throws(
    () => encodeDeterministicZip([{ path: 'UI/a', data: Buffer.alloc(0) }, { path: 'ui/a', data: Buffer.alloc(0) }]),
    /collide/,
  );
  assert.throws(
    () => encodeDeterministicZip([{ path: 'ui', data: Buffer.alloc(0) }, { path: 'ui/a', data: Buffer.alloc(0) }]),
    /parent file/,
  );
  assert.throws(
    () => encodeDeterministicZip([{ path: 'ui/café.png', data: Buffer.alloc(0) }]),
    /portable ASCII/,
  );
  assert.throws(
    () => encodeDeterministicZip([{ path: 'large.bin', data: Buffer.alloc(20 * 1024 * 1024 + 1) }]),
    /exceeds package limit/,
  );
  assert.throws(() => decodeZip(Buffer.alloc(25 * 1024 * 1024 + 1)), /archive exceeds/);

  const bomb = encodeDeterministicZip(
    [{ path: 'bomb.bin', data: Buffer.alloc(2 * 1024 * 1024) }],
    { compression: 'deflate' },
  );
  assert.throws(() => decodeZip(bomb), /compression ratio is unsafe/);

  const unsupported = encodeDeterministicZip([{ path: 'safe', data: Buffer.from('x') }]);
  const modified = Buffer.from(unsupported);
  modified.writeUInt16LE(12, centralOffset(modified) + 10);
  assert.throws(() => decodeZip(modified), /Unsupported ZIP compression/);

  const hidden = addHiddenByteBeforeCentral(unsupported);
  assert.throws(() => decodeZip(hidden), /hidden bytes/);

  const unsupportedFlags = Buffer.from(unsupported);
  unsupportedFlags.writeUInt16LE(0x0802, 6);
  unsupportedFlags.writeUInt16LE(0x0802, centralOffset(unsupportedFlags) + 8);
  assert.throws(() => decodeZip(unsupportedFlags), /flags/);
});

test('package validation rejects unlisted payloads and altered file indexes', async (context) => {
  const temporary = await temporaryDirectory();
  context.after(temporary.cleanup);
  const source = temporary.resolve('source');
  await createCartridge(source);
  const packed = await packDirectory(source);
  const decoded = decodeZip(packed.archive);
  const withExtra = encodeDeterministicZip([
    ...[...decoded.entries].map(([path, data]) => ({ path, data })),
    { path: 'unlisted.txt', data: Buffer.from('not indexed') },
  ]);
  assert.throws(() => validateWavegame(withExtra), /do not exactly match/);

  const entries = [...decoded.entries].map(([path, data]) => ({ path, data: Buffer.from(data) }));
  const rules = entries.find((entry) => entry.path === 'rules/index.mjs');
  rules.data[0] ^= 1;
  const altered = encodeDeterministicZip(entries);
  assert.throws(() => validateWavegame(altered), /digest or size mismatch/);
});

function centralOffset(archive) {
  return archive.readUInt32LE(archive.length - 22 + 16);
}

function localDataStart(archive, offset) {
  return offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28);
}

function addHiddenByteBeforeCentral(archive) {
  const oldCentral = centralOffset(archive);
  const output = Buffer.concat([archive.subarray(0, oldCentral), Buffer.from([0]), archive.subarray(oldCentral)]);
  output.writeUInt32LE(oldCentral + 1, output.length - 22 + 16);
  return output;
}
