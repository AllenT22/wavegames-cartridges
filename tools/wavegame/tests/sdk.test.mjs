import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { GameClient, connect, WaveGames } from '../sdk/wavegames-sdk.mjs';
import { createPlayers, SimulationHost } from '../sdk/simulation-host.mjs';

const counterRules = {
  create: ({ players }) => ({ value: 0, turn: players[0].id, secret: 'authority-only' }),
  reduce: ({ state, playerId, action, random }) => {
    if (action.type === 'reject') {
      random.nextInt(100);
      return { accepted: false, reason: 'rejected' };
    }
    if (playerId !== state.turn || action.type !== 'increment') return { accepted: false, reason: 'bad action' };
    return {
      accepted: true,
      state: { ...state, value: state.value + 1, turn: playerId === 'player-1' ? 'player-2' : 'player-1' },
      events: [{ type: 'incremented' }],
    };
  },
  view: ({ state, viewer, revision }) => ({ value: state.value, turn: state.turn, viewer, revision }),
};

test('simulation host separates authority state from filtered seat views', async () => {
  const host = new SimulationHost({ rules: counterRules, players: createPlayers(2), seed: 42 });
  await host.initialize();
  const view = await host.viewForSeat(1);
  assert.equal(Object.hasOwn(view, 'secret'), false);
  view.value = 99;
  assert.equal((await host.viewForSeat(1)).value, 0);
  const rejected = await host.dispatchAction(1, { type: 'reject' });
  assert.deepEqual(rejected, { accepted: false, reason: 'rejected', revision: 0 });
  assert.equal(host.revision, 0);
  const accepted = await host.dispatchAction(1, { type: 'increment' });
  assert.deepEqual(accepted, { accepted: true, revision: 1 });
  assert.equal((await host.viewForSeat(2)).value, 1);
  const replay = host.replaySnapshot();
  assert.equal(replay.revision, 1);
  assert.deepEqual(replay.actions.map((entry) => entry.result.accepted), [false, true]);
  replay.actions[0].action.type = 'tampered';
  assert.equal(host.replaySnapshot().actions[0].action.type, 'reject');
});

test('create and reduce share the native-compatible deterministic random stream', async () => {
  const seed = 42;
  const expected = mulberry32Draws(seed, 2).map((value) => Math.floor(value * 1_000_000));
  const rules = {
    create: ({ random }) => ({ draws: [random.nextInt(1_000_000)] }),
    reduce: ({ state, random }) => ({
      accepted: true,
      state: { draws: [...state.draws, random.nextInt(1_000_000)] },
    }),
    view: ({ state }) => state,
  };
  const host = new SimulationHost({ rules, players: createPlayers(1), seed });
  await host.initialize();
  assert.deepEqual(host.stateSnapshot().draws, expected.slice(0, 1));
  await host.dispatchAction(1, { type: 'draw' });
  assert.deepEqual(host.stateSnapshot().draws, expected);
});

test('MessagePort bridge provides context, actions, views, events, and scoped storage', async (context) => {
  const host = new SimulationHost({ rules: counterRules, players: createPlayers(2), seed: 7 });
  const channel = new MessageChannel();
  const client = new GameClient(channel.port2);
  context.after(() => {
    client.close();
    host.detachSeat(1);
  });
  const firstView = new Promise((resolve) => client.onView(resolve));
  await host.attachSeat(1, channel.port1);
  await client.ready;
  assert.equal(client.context.seat, 1);
  assert.equal((await firstView).value, 0);
  const nextView = new Promise((resolve) => client.onView(resolve));
  assert.deepEqual(await client.sendAction({ type: 'increment' }), { accepted: true, reason: undefined, revision: 1 });
  assert.equal((await nextView).value, 1);
  await client.storage.set('preferences', { sound: false });
  assert.deepEqual(await client.storage.get('preferences'), { sound: false });
  await client.storage.remove('preferences');
  assert.equal(await client.storage.get('preferences'), null);
  await assert.rejects(() => client.sendAction({ type: 'x', payload: 'x'.repeat(600) }), /limit is 512/);
});

test('self-contained SDK uses injected native runtime without overwriting it', async (context) => {
  const originalWindow = globalThis.window;
  context.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  const fake = new FakeWindow();
  globalThis.window = fake;
  const session = nativeSession();
  const injected = { connect: async ({ api }) => (assert.equal(api, 1), session) };
  fake.WaveGames = injected;
  assert.equal(await connect({ api: 1 }), session);
  assert.equal(fake.WaveGames, injected);
  assert.notEqual(fake.WaveGames, WaveGames);
});

test('self-contained SDK waits for the native runtime-ready event', async (context) => {
  const originalWindow = globalThis.window;
  context.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  const fake = new FakeWindow();
  globalThis.window = fake;
  const session = nativeSession();
  const pending = connect({ api: 1, timeoutMs: 1_000 });
  fake.WaveGames = { connect: () => session };
  fake.dispatchEvent(new Event('wavegames:runtime-ready'));
  assert.equal(await pending, session);
});

class FakeWindow extends EventTarget {
  constructor() {
    super();
    this.parent = this;
    this.setTimeout = setTimeout;
    this.clearTimeout = clearTimeout;
  }
}

function nativeSession() {
  return {
    context: { playerId: 'player-1', seat: 1 },
    sendAction: async () => ({ accepted: true, revision: 1 }),
    onView: () => () => {},
    onRoster: () => () => {},
    onStatus: () => () => {},
    storage: { get: async () => null, set: async () => null, remove: async () => null },
  };
}

function mulberry32Draws(seed, count) {
  let state = seed || 0x6d2b79f5;
  return Array.from({ length: count }, () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  });
}
