#!/usr/bin/env node
import { lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createCartridge } from '../src/scaffold.mjs';
import { packDirectory, prettySummary, validateSourceDirectory, validateWavegame } from '../src/package.mjs';
import { runCartridgeTests } from '../src/testing.mjs';
import { startSimulator } from '../simulator/server.mjs';
import { readFile } from 'node:fs/promises';

const usage = `Wave Games cartridge developer tools

Usage:
  wavegame create <directory> [--id <reverse.domain.id>] [--title <name>]
  wavegame validate <directory|file.wavegame>
  wavegame pack <directory> [output.wavegame]
  wavegame inspect <directory|file.wavegame>
  wavegame test <trusted-source-directory>
  wavegame dev <directory|file.wavegame> [--port <number>]
  wavegame simulate <directory|file.wavegame> [--port <number>]
`;

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`wavegame: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main(arguments_) {
  const command = arguments_.shift();
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(usage);
    return;
  }
  if (command === 'create') {
    const directory = requireArgument(arguments_, 'destination directory');
    const options = parseOptions(arguments_, new Set(['id', 'title']));
    const created = await createCartridge(directory, options);
    process.stdout.write(`Created ${created.manifest.id} in ${created.root}\n`);
    return;
  }
  if (command === 'pack') {
    const source = requireArgument(arguments_, 'source directory');
    const output = arguments_.shift() ?? path.resolve(`${path.basename(path.resolve(source))}.wavegame`);
    if (arguments_.length !== 0) throw new Error('pack received too many arguments');
    const packed = await packDirectory(source);
    await writeFile(output, packed.archive, { flag: 'wx' });
    process.stdout.write(`Packed ${packed.summary.id} ${packed.summary.version}\n${path.resolve(output)}\n${packed.summary.packageDigest}\n`);
    return;
  }
  if (command === 'validate' || command === 'inspect') {
    const target = requireArgument(arguments_, 'cartridge directory or archive');
    if (arguments_.length !== 0) throw new Error(`${command} received too many arguments`);
    const summary = await readSummary(target);
    if (command === 'inspect') process.stdout.write(`${JSON.stringify(prettySummary(summary), null, 2)}\n`);
    else process.stdout.write(`Valid ${summary.id} ${summary.version}\n${summary.packageDigest}\n`);
    return;
  }
  if (command === 'test') {
    const target = requireArgument(arguments_, 'trusted cartridge source directory');
    if (arguments_.length !== 0) throw new Error('test received too many arguments');
    const details = await lstat(target);
    if (!details.isDirectory()) {
      throw new Error('test executes developer rules and scenarios; use a trusted source directory, never a downloaded .wavegame archive');
    }
    const report = await runCartridgeTests(target);
    for (const result of report.results) process.stdout.write(`ok - ${result.name}\n`);
    process.stdout.write(`${report.results.length} cartridge checks passed\n`);
    return;
  }
  if (command === 'simulate' || command === 'dev') {
    const target = requireArgument(arguments_, 'cartridge directory or archive');
    const options = parseOptions(arguments_, new Set(['port']));
    const port = options.port === undefined ? 0 : Number(options.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be from 0 through 65535');
    const simulator = await startSimulator(target, { port });
    process.stdout.write(`Wave Games simulator: ${simulator.url}\nPress Ctrl-C to stop.\n`);
    const stop = async () => {
      await simulator.close();
      process.exit(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return;
  }
  throw new Error(`Unknown command ${command}\n\n${usage}`);
}

async function readSummary(target) {
  const details = await lstat(target);
  return details.isDirectory()
    ? validateSourceDirectory(target)
    : validateWavegame(await readFile(target));
}

function requireArgument(arguments_, label) {
  const value = arguments_.shift();
  if (!value || value.startsWith('-')) throw new Error(`Missing ${label}`);
  return value;
}

function parseOptions(arguments_, allowed) {
  const options = Object.create(null);
  while (arguments_.length !== 0) {
    const option = arguments_.shift();
    if (!option.startsWith('--') || !allowed.has(option.slice(2))) throw new Error(`Unknown option ${option}`);
    const value = arguments_.shift();
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
    if (Object.hasOwn(options, option.slice(2))) throw new Error(`Duplicate option ${option}`);
    options[option.slice(2)] = value;
  }
  return options;
}
