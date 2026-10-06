import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { startSimulator } from '../simulator/server.mjs';
import { createCartridge } from '../src/scaffold.mjs';
import { runCartridgeTests } from '../src/testing.mjs';
import { temporaryDirectory } from './helpers.mjs';

const cli = path.resolve(new URL('../bin/wavegame.mjs', import.meta.url).pathname);
const repositoryRoot = path.resolve(new URL('../../..', import.meta.url).pathname);
const connectFour = path.join(repositoryRoot, 'cartridges', 'connect-four');

test('CLI create, validate, pack, inspect, and test work without dependencies', async (context) => {
  const temporary = await temporaryDirectory();
  context.after(temporary.cleanup);
  const source = temporary.resolve('my-game');
  const archive = temporary.resolve('my-game.wavegame');
  assert.match(run(['create', source, '--id', 'games.example.cli-game', '--title', 'CLI Game']).stdout, /Created/);
  assert.equal((await readFile(path.join(source, 'ui', 'wavegames-sdk.mjs'), 'utf8')).includes('wavegames:runtime-ready'), true);
  assert.match(run(['validate', source]).stdout, /Valid games\.example\.cli-game/);
  assert.match(run(['pack', source, archive]).stdout, /Packed games\.example\.cli-game/);
  const inspected = JSON.parse(run(['inspect', archive]).stdout);
  assert.equal(inspected.id, 'games.example.cli-game');
  assert.equal(inspected.files.some((file) => file.path === 'wavegame.json'), true);
  assert.match(run(['test', source]).stdout, /cartridge checks passed/);
  assert.match(runFailure(['test', archive]).stderr, /trusted source directory/);
});

test('browser simulator serves a cartridge and 1-8-seat controls safely', async (context) => {
  const simulator = await startSimulator(connectFour);
  context.after(simulator.close);
  const html = await fetch(simulator.url).then((response) => response.text());
  assert.match(html, /Wave Games developer simulator/);
  const app = await fetch(new URL('/app.mjs', simulator.url)).then((response) => response.text());
  assert.match(app, /count <= 8/);
  assert.match(app, /wavegames:client-ready/);
  assert.match(app, /copyReplay/);
  assert.match(app, /class FaultInjector/);
  assert.match(app, /class RulesWorkerClient/);
  assert.match(app, /new Worker\('\/rules-worker\.mjs'/);
  assert.match(app, /toggleSeat/);
  assert.match(app, /attachFrame\(seat/);
  assert.doesNotMatch(app, /frame\.addEventListener\('load'/);
  const sdkResponse = await fetch(new URL('/cartridge/ui/wavegames-sdk.mjs', simulator.url));
  assert.equal(sdkResponse.status, 200);
  assert.equal(sdkResponse.headers.get('access-control-allow-origin'), '*');
  assert.match(await sdkResponse.text(), /runtime-ready/);
  const workerResponse = await fetch(new URL('/rules-worker.mjs', simulator.url));
  assert.equal(workerResponse.status, 200);
  const workerSource = await workerResponse.text();
  assert.match(workerSource, /new SimulationHost/);
  assert.match(workerSource, /installAuthoritativeDeterminismGuard\(\)/);
  const escapeResponse = await fetch(new URL('/cartridge/..%2FREADME.md', simulator.url));
  assert.equal(escapeResponse.status, 400);
});

test('test worker denies ambient nondeterminism before rules and scenarios import', async (context) => {
  const temporary = await temporaryDirectory();
  context.after(temporary.cleanup);
  const source = temporary.resolve('deterministic-game');
  await createCartridge(source, { id: 'games.example.determinism-guard', title: 'Determinism Guard' });

  const manifestPath = path.join(source, 'wavegame.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.modes.local.maxPlayers = 2;
  manifest.modes.wave.maxPlayers = 2;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(source, 'rules', 'index.mjs'), guardedRulesFixture);
  await writeFile(path.join(source, 'tests', 'scenarios.mjs'), guardedScenarioFixture);

  const report = await runCartridgeTests(source);
  assert.deepEqual(report.results.map((result) => result.name), [
    'rules contract (2 players)',
    'scenario import uses the guarded realm',
  ]);
});

test('CLI dev alias starts the multi-seat simulator', async () => {
  const child = spawn(process.execPath, [cli, 'dev', connectFour, '--port', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { errors += chunk; });
  try {
    const url = await waitForUrl(() => output, child);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /developer simulator/);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
  assert.equal(errors, '');
});

test('Connect Four fixture passes contract and playable victory scenarios', async () => {
  const report = await runCartridgeTests(connectFour);
  assert.deepEqual(report.results.map((result) => result.name), [
    'rules contract (2 players)',
    'horizontal victory and turn enforcement',
    'vertical victory',
    'descending diagonal victory',
    'ascending diagonal victory',
    'full column rejects without revision',
    'draw fills the board without a winning line',
    'surrender and two rematch votes reset with swapped opener',
    'per-seat views identify each player and isolate mutable copies',
    'invalid inputs and premature rematch preserve authority and turn',
    'queued double input accepts only one move and protects finished board',
    'rematches rotate disc ownership, legal moves and votes across two games',
  ]);
});

function run(arguments_) {
  const result = spawnSync(process.execPath, [cli, ...arguments_], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function runFailure(arguments_) {
  const result = spawnSync(process.execPath, [cli, ...arguments_], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, result.stdout);
  return result;
}

function waitForUrl(output, child) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const match = /Wave Games simulator: (http:\/\/[^\s]+)/.exec(output());
      if (match) return resolve(match[1]);
      if (child.exitCode !== null) return reject(new Error(`dev exited before serving: ${child.exitCode}`));
      if (Date.now() - started > 5_000) return reject(new Error('Timed out waiting for wavegame dev'));
      setTimeout(poll, 20);
    };
    poll();
  });
}

const guardedRulesFixture = `
function expectDenied(name, operation) {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error(name + ' was not denied');
}

const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric' });
let capturedReflectTarget = false;
Reflect.construct = () => { capturedReflectTarget = true; throw new Error('tampered construct'); };
Reflect.apply = () => { capturedReflectTarget = true; throw new Error('tampered apply'); };
for (const [name, operation] of [
  ['Date()', () => Date()],
  ['Date(argument)', () => Date(0)],
  ['new Date()', () => new Date()],
  ['Date.now()', () => Date.now()],
  ['Intl.DateTimeFormat.format()', () => formatter.format()],
  ['Intl.DateTimeFormat.format(undefined)', () => formatter.format(undefined)],
  ['Intl.DateTimeFormat.formatToParts()', () => formatter.formatToParts()],
  ['Temporal.Now', () => Temporal.Now.instant()],
  ['crypto', () => crypto.getRandomValues(new Uint8Array(1))],
  ['performance', () => performance.now()],
  ['setTimeout', () => { const handle = setTimeout(() => {}, 0); clearTimeout(handle); }],
  ['setInterval', () => { const handle = setInterval(() => {}, 0); clearInterval(handle); }],
  ['setImmediate', () => { const handle = setImmediate(() => {}); clearImmediate(handle); }],
  ['requestAnimationFrame', () => requestAnimationFrame(() => {})],
  ['requestIdleCallback', () => requestIdleCallback(() => {})],
  ['localStorage', () => localStorage.getItem('x')],
  ['sessionStorage', () => sessionStorage.getItem('x')],
  ['indexedDB', () => indexedDB.open('x')],
  ['caches', () => caches.open('x')],
  ['Math.random', () => Math.random()],
]) expectDenied(name, operation);

if (typeof process !== 'undefined') {
  expectDenied('process.hrtime', () => process.hrtime());
  expectDenied('process.hrtime.bigint', () => process.hrtime.bigint());
  expectDenied('process.uptime', () => process.uptime());
}

if (new Date(0).toISOString() !== '1970-01-01T00:00:00.000Z') throw new Error('new Date(0) changed');
if (Date.parse('1970-01-01T00:00:00.000Z') !== 0) throw new Error('Date.parse changed');
if (Date.UTC(1970, 0, 1) !== 0) throw new Error('Date.UTC changed');
if (!formatter.format(0).includes('1970')) throw new Error('explicit Intl formatting changed');
if (!Array.isArray(formatter.formatToParts(0))) throw new Error('explicit Intl parts changed');
if (capturedReflectTarget) throw new Error('guard used cartridge-mutated Reflect intrinsics');

export function create({ players }) {
  return { turn: players[0].id, epoch: new Date(0).toISOString() };
}

export function reduce({ state }) {
  return { accepted: true, state };
}

export function view({ state }) {
  return state;
}
`;

const guardedScenarioFixture = `
let denied = false;
try { Date.now(); } catch { denied = true; }
if (!denied) throw new Error('scenario module imported outside the guarded realm');
const epoch = new Date(0).toISOString();

export const scenarios = [{
  name: 'scenario import uses the guarded realm',
  players: 2,
  async run({ host, assert }) {
    assert.equal(epoch, '1970-01-01T00:00:00.000Z');
    assert.equal((await host.viewForSeat(1)).epoch, epoch);
  },
}];
`;
