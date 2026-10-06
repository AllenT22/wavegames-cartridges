#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  encodeDeterministicZip,
  packDirectory,
  readSourceDirectory,
  runCartridgeTests,
  validateWavegame,
} from '../src/index.mjs';

const bundleVersion = '1.1.0';
const games = Object.freeze([
  Object.freeze({ slug: 'connect-four', label: 'Connect Four', players: '2' }),
  Object.freeze({ slug: 'checkers', label: 'Checkers', players: '2' }),
  Object.freeze({ slug: 'chess', label: 'Chess', players: '2' }),
  Object.freeze({ slug: 'go', label: 'Go', players: '2' }),
  Object.freeze({ slug: 'color-match', label: 'Color Match', players: '2-8' }),
]);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(scriptDirectory, '../../..');
const requestedOutput = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repository, 'artifacts', `cartridge-examples-${bundleVersion}`);

main().catch((error) => {
  process.stderr.write(`first-party cartridge build: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  if (process.argv.length > 3) throw new Error('Usage: build-first-party.mjs [output-directory]');
  try {
    await lstat(requestedOutput);
    throw new Error(`Refusing to replace existing output: ${requestedOutput}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const parent = path.dirname(requestedOutput);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(path.join(parent, '.cartridge-release-'));
  try {
    const releases = [];
    const packageEntries = [];
    for (const game of games) {
      const source = path.join(repository, 'cartridges', game.slug);
      const report = await runCartridgeTests(source);
      const packed = await packDirectory(source);
      const validated = validateWavegame(packed.archive);
      if (validated.packageDigest !== packed.summary.packageDigest) {
        throw new Error(`${game.label} package digest changed during validation`);
      }
      const filename = `WaveGames-${fileSlug(game.label)}-${packed.summary.version}.wavegame`;
      await writeFile(path.join(staging, filename), packed.archive, { flag: 'wx' });
      packageEntries.push({ path: `packages/${filename}`, data: packed.archive });
      releases.push({
        id: packed.summary.id,
        title: game.label,
        version: packed.summary.version,
        players: game.players,
        file: filename,
        packageDigest: packed.summary.packageDigest,
        sha256: sha256(packed.archive),
        bytes: packed.archive.length,
        checks: report.results.length,
      });
    }

    const sourceArchive = await buildSourceArchive();
    const sourceFilename = `WaveGames-Cartridge-Example-Sources-${bundleVersion}.zip`;
    await writeFile(path.join(staging, sourceFilename), sourceArchive, { flag: 'wx' });

    const release = {
      formatVersion: 1,
      engineApi: 1,
      bundleVersion,
      distribution: 'public-unverified',
      games: releases,
    };
    const releaseText = `${JSON.stringify(release, null, 2)}\n`;
    const testingText = testingInstructions(releases, sourceFilename);
    await writeFile(path.join(staging, 'RELEASE.json'), releaseText, { flag: 'wx' });
    await writeFile(path.join(staging, 'TESTING.md'), testingText, { flag: 'wx' });

    const checksumRecords = [
      ...releases.map((item) => ({ file: item.file, digest: item.sha256 })),
      { file: sourceFilename, digest: sha256(sourceArchive) },
      { file: 'RELEASE.json', digest: sha256(releaseText) },
      { file: 'TESTING.md', digest: sha256(testingText) },
    ];
    const checksums = checksumText(checksumRecords);
    await writeFile(path.join(staging, 'SHA256SUMS.txt'), checksums, { flag: 'wx' });

    const bundleFilename = `WaveGames-Cartridge-Examples-${bundleVersion}.zip`;
    const bundle = encodeDeterministicZip([
      ...packageEntries,
      { path: `source/${sourceFilename}`, data: sourceArchive },
      { path: 'RELEASE.json', data: releaseText },
      { path: 'TESTING.md', data: testingText },
      { path: 'SHA256SUMS.txt', data: checksums },
    ], { compression: 'deflate' });
    await writeFile(path.join(staging, bundleFilename), bundle, { flag: 'wx' });
    checksumRecords.push({ file: bundleFilename, digest: sha256(bundle) });
    await writeFile(path.join(staging, 'SHA256SUMS-ALL.txt'), checksumText(checksumRecords), { flag: 'wx' });

    await rename(staging, requestedOutput);
    process.stdout.write(`Built ${releases.length} first-party cartridges\n${requestedOutput}\n`);
    for (const item of releases) {
      process.stdout.write(`${item.file}\n  package ${item.packageDigest}\n  sha256  ${item.sha256}\n`);
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function buildSourceArchive() {
  const entries = [];
  for (const game of games) {
    const files = await readSourceDirectory(path.join(repository, 'cartridges', game.slug));
    for (const [entryPath, data] of files) {
      entries.push({ path: `cartridges/${game.slug}/${entryPath}`, data });
    }
  }
  const toolFiles = await readSourceDirectory(path.join(repository, 'tools', 'wavegame'));
  for (const [entryPath, data] of toolFiles) {
    entries.push({ path: `tools/wavegame/${entryPath}`, data });
  }
  const cartridgeReadme = await readFile(path.join(repository, 'cartridges', 'README.md'));
  entries.push({ path: 'cartridges/README.md', data: cartridgeReadme });
  entries.push({ path: 'README.md', data: sourceReadme() });
  return encodeDeterministicZip(entries, { compression: 'deflate' });
}

function testingInstructions(releases, sourceFilename) {
  const table = releases
    .map((item) => `| ${item.title} | ${item.players} | \`${item.file}\` | \`${item.packageDigest}\` |`)
    .join('\n');
  return `# WaveGames Cartridge API 1 test bundle

These public packages use Cartridge API 1 and are ready for testing with a
cartridge-capable WaveGames build. The **Unverified** label in the app is expected: API 1 validates
package contents and exact digests but does not claim publisher signatures.

## Import and play

1. Save one or more \`.wavegame\` files to Downloads or Files on your device.
2. In WaveGames, open **Library**, choose **Import cartridge**, and select a file.
   Some builds label this **Game Library / Import game**.
3. Return to **Game Lobby**. The host selects the game and approves the players.
   Join with the exact same package installed; packages are not sent through the mesh.
4. For radio play, connect each phone to its own compatible radio first.
5. Compare the package digest shown by the app with the digest below if a phone
   reports a mismatch.

| Game | Players | Import file | Cartridge package digest |
| --- | ---: | --- | --- |
${table}

\`SHA256SUMS-ALL.txt\` verifies the copied release files. \`${sourceFilename}\`
contains every cartridge source file plus the dependency-free API 1 toolkit,
tests, packer, and simulator used to reproduce the packages.

## Acceptance boundary

Automated rules, determinism, privacy, package, and archive validation have been
run before this bundle is emitted. Real Files/Downloads import, system WebView
sandbox behavior, BLE recovery, board routing, and multi-phone play still need
to be exercised on the intended phones and boards before public release.
`;
}

function sourceReadme() {
  return `# WaveGames first-party cartridge source\n\nThis archive contains the ${games.length} API 1 example games and the exact dependency-free developer toolkit needed to test, simulate, validate, and pack them. Run the commands documented in \`tools/wavegame/README.md\` with Node.js 24 or newer.\n`;
}

function checksumText(records) {
  return `${records.map((item) => `${item.digest}  ${item.file}`).join('\n')}\n`;
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function fileSlug(label) {
  return label.replaceAll(/[^A-Za-z0-9]+/g, '-').replaceAll(/^-|-$/g, '');
}
