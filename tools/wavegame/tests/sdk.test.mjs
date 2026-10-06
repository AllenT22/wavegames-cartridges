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
  delete session.onEvent; // Events are optional in the native API 1 contract.
  const injected = { connect: async ({ api }) => (assert.equal(api, 1), session) };
  fake.WaveGames = injected;
  const client = await connect({ api: 1 });
  assert.equal(client.context, session.context);
  assert.equal(typeof client.onEvent(() => {}), 'function');
  assert.deepEqual(await client.sendAction({ type: 'increment' }), { accepted: true, revision: 1 });
  client.close();
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
  const client = await pending;
  assert.equal(client.context, session.context);
  client.close();
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
    onEvent: () => () => {},
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

function readyClient(context, details = {}) {
  const channel = new MessageChannel();
  const client = new GameClient(channel.port2, { requestTimeoutMs: 20, contextTimeoutMs: 100, ...details });
  context.after(() => { client.close(); channel.port1.close(); });
  channel.port1.postMessage({ api: 1, type: 'context', context: { playerId: 'player-1', seat: 1, revision: 0 } });
  return { client, host: channel.port1 };
}

test('dropped action times out once, clears pending state, and permits a later acknowledged action', async (context) => {
  const { client, host } = readyClient(context);
  await client.ready;
  let calls = 0;
  host.on('message', (message) => {
    calls += 1;
    if (calls > 1) host.postMessage({ api: 1, type: 'actionResult', callId: message.callId, accepted: true, revision: 1 });
  });
  await assert.rejects(client.sendAction({ type: 'increment' }), /Check the current turn/);
  assert.equal(calls, 1, 'uncertain actions must never be automatically retried');
  assert.equal(client.pending.size, 0);
  assert.equal((await client.sendAction({ type: 'increment' })).accepted, true);
});

test('closed bridge before context rejects readiness instead of hanging', async () => {
  const channel = new MessageChannel();
  const client = new GameClient(channel.port2);
  const rejection = assert.rejects(client.ready, /bridge closed/);
  client.close();
  await rejection;
  channel.port1.close();
});

test('missing context has a deadline and closes the MessagePort', async () => {
  const channel = new MessageChannel();
  const client = new GameClient(channel.port2, { contextTimeoutMs: 15 });
  await assert.rejects(client.ready, /Timed out/);
  assert.equal(client.closed, true);
  channel.port1.close();
});

test('disconnect rejects in-flight actions and blocks new sends until connected', async (context) => {
  const { client, host } = readyClient(context, { requestTimeoutMs: 100 });
  await client.ready;
  host.on('message', () => host.postMessage({ api: 1, type: 'status', status: 'disconnected' }));
  await assert.rejects(client.sendAction({ type: 'increment' }), /disconnected/);
  assert.equal(client.pending.size, 0);
  await assert.rejects(client.sendAction({ type: 'increment' }), /disconnected/);
});

test('late action replies and reordered stale views do not revive expired requests or rewind state', async (context) => {
  const { client, host } = readyClient(context);
  await client.ready;
  let callId;
  host.on('message', (message) => { callId = message.callId; });
  await assert.rejects(client.sendAction({ type: 'increment' }), /No response/);
  const view = new Promise(resolve => client.onView(resolve));
  host.postMessage({ api: 1, type: 'actionResult', callId, accepted: true, revision: 2 });
  host.postMessage({ api: 1, type: 'view', view: { value: 2 }, revision: 2 });
  assert.deepEqual(await view, { value: 2 });
  host.postMessage({ api: 1, type: 'view', view: { value: 1 }, revision: 1 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(client.view, { value: 2 });
  assert.equal(client.revision, 2);
  assert.equal(client.pending.size, 0);
});

test('synchronous transport failure clears request timers and pending state', async (context) => {
  const { client } = readyClient(context);
  await client.ready;
  client.port.postMessage = () => { throw new Error('transport unavailable'); };
  await assert.rejects(client.sendAction({ type: 'increment' }), /transport unavailable/);
  assert.equal(client.pending.size, 0);
});

test('injected native session connection and requests have deadlines without resending', async (context) => {
  const original = globalThis.window;
  context.after(() => { if (original === undefined) delete globalThis.window; else globalThis.window = original; });
  const fake = new FakeWindow();
  globalThis.window = fake;
  fake.WaveGames = { connect: () => new Promise(() => {}) };
  await assert.rejects(connect({ timeoutMs: 15 }), /Timed out/);
  let calls = 0;
  const session = nativeSession();
  session.sendAction = () => { calls += 1; return new Promise(() => {}); };
  session.storage.get = () => new Promise(() => {});
  fake.WaveGames = { connect: () => session };
  const client = await connect({ requestTimeoutMs: 15 });
  await assert.rejects(client.sendAction({ type: 'increment' }), /Check the current turn/);
  await assert.rejects(client.storage.get('preferences'), /No response/);
  assert.equal(calls, 1);
  client.close();
});

test('native status loss rejects pending operations immediately and reconnect permits new actions', async (context) => {
  const original = globalThis.window;
  context.after(() => { if (original === undefined) delete globalThis.window; else globalThis.window = original; });
  const session = nativeSession(), listeners = new Set();
  session.onStatus = callback => { listeners.add(callback); return () => listeners.delete(callback); };
  session.sendAction = () => new Promise(() => {});
  const fake = new FakeWindow();fake.WaveGames = { connect: () => session };globalThis.window = fake;
  const client = await connect({ requestTimeoutMs: 1000 });
  const action = client.sendAction({ type: 'increment' });
  const rejected = assert.rejects(action, /disconnected/);
  for (const listener of listeners) listener('disconnected');
  await rejected;
  await assert.rejects(client.sendAction({ type: 'increment' }), /disconnected/);
  session.sendAction = async () => ({ accepted: true, revision: 1 });
  for (const listener of listeners) listener('connected');
  assert.equal((await client.sendAction({ type: 'increment' })).accepted, true);
  client.close();
});

test('simulator same-seat reconnect obtains the current filtered view and retains scoped storage', async (context) => {
  const host = new SimulationHost({ rules: counterRules, players: createPlayers(2), seed: 7 });
  const firstChannel = new MessageChannel(), first = new GameClient(firstChannel.port2);
  await host.attachSeat(1, firstChannel.port1);await first.ready;
  await first.storage.set('choice', { sound: false });
  await first.sendAction({ type: 'increment' });
  first.close();host.detachSeat(1);
  await host.dispatchAction(2, { type: 'increment' });
  const secondChannel = new MessageChannel(), second = new GameClient(secondChannel.port2);
  context.after(() => { second.close();host.detachSeat(1); });
  const view = new Promise(resolve => second.onView(resolve));
  await host.attachSeat(1, secondChannel.port1);await second.ready;
  assert.equal((await view).value, 2);
  assert.equal(second.context.revision, 2);
  assert.deepEqual(await second.storage.get('choice'), { sound: false });
});
