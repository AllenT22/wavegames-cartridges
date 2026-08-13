import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { installAuthoritativeDeterminismGuard } from '../sdk/determinism-guard.mjs';
import { createPlayers, SimulationHost } from '../sdk/simulation-host.mjs';
import { canonicalJson } from './json.mjs';

installAuthoritativeDeterminismGuard();

try {
  const report = await run(workerData);
  parentPort.postMessage({ ok: true, report });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
  });
} finally {
  parentPort.close();
}

async function run({ root, summary }) {
  const results = [];
  const rulesPath = path.join(root, ...summary.manifest.entrypoints.rules.split('/'));
  const rules = await importModule(rulesPath);
  const mode = summary.manifest.modes.local ?? summary.manifest.modes.wave;
  for (let playerCount = mode.minPlayers; playerCount <= mode.maxPlayers; playerCount += 1) {
    const players = createPlayers(playerCount);
    const first = new SimulationHost({ rules, players, seed: 0x57415645, packageId: summary.id });
    const second = new SimulationHost({ rules, players, seed: 0x57415645, packageId: summary.id });
    await Promise.all([first.initialize(), second.initialize()]);
    assert.equal(canonicalJson(first.stateSnapshot()), canonicalJson(second.stateSnapshot()), `create() is not deterministic for ${playerCount} players`);
    for (let seat = 1; seat <= playerCount; seat += 1) await first.viewForSeat(seat);
    if (typeof rules.conformanceActions === 'function') {
      const trace = await rules.conformanceActions({
        players: clone(players),
        state: first.stateSnapshot(),
      });
      if (!Array.isArray(trace) || trace.length > 256) {
        throw new Error('conformanceActions() must return at most 256 {seat, action} records');
      }
      for (const record of trace) {
        if (!record || !Number.isInteger(record.seat) || !Object.hasOwn(record, 'action')) {
          throw new Error('conformanceActions() records require seat and action');
        }
        const [left, right] = await Promise.all([
          first.dispatchAction(record.seat, clone(record.action)),
          second.dispatchAction(record.seat, clone(record.action)),
        ]);
        assert.equal(canonicalJson(left), canonicalJson(right), 'reduction result is not deterministic');
        assert.equal(
          canonicalJson(first.stateSnapshot()),
          canonicalJson(second.stateSnapshot()),
          'replayed authority state is not deterministic',
        );
      }
    }
    results.push({ name: `rules contract (${playerCount} players)`, passed: true });
  }

  const scenariosPath = path.join(root, 'tests', 'scenarios.mjs');
  if (await exists(scenariosPath)) {
    const scenarioModule = await importModule(scenariosPath);
    if (!Array.isArray(scenarioModule.scenarios)) throw new Error('tests/scenarios.mjs must export a scenarios array');
    for (const scenario of scenarioModule.scenarios) {
      if (!scenario || typeof scenario.name !== 'string' || !Number.isInteger(scenario.players) || typeof scenario.run !== 'function') {
        throw new Error('Each cartridge scenario requires name, players, and run()');
      }
      if (scenario.players < mode.minPlayers || scenario.players > mode.maxPlayers) throw new Error(`Scenario ${scenario.name} uses an unsupported player count`);
      const players = createPlayers(scenario.players);
      const host = new SimulationHost({ rules, players, seed: scenario.seed ?? 1, packageId: summary.id });
      await host.initialize();
      await scenario.run({ host, players, assert });
      results.push({ name: scenario.name, passed: true });
    }
  }
  return { summary, results };
}

function importModule(modulePath) {
  return import(pathToFileURL(modulePath).href);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function clone(value) {
  return structuredClone(value);
}
