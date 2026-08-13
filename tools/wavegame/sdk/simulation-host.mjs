import { canonicalJson, assertJsonValue } from '../src/json.mjs';
import { RUNTIME_LIMITS } from '../src/constants.mjs';
import { assertBridgeMessage, bindMessagePort, bridgeMessage } from './protocol.mjs';

const encoder = new TextEncoder();

export class SimulationHost {
  constructor({
    rules,
    players,
    seed = 1,
    options = {},
    packageId = 'local.simulation.cartridge',
    packageVersion = '0.0.0',
    packageDigest = 'simulation',
    locale = 'en',
    theme = 'system',
  }) {
    validateRules(rules);
    validatePlayers(players);
    assertSizedJson(options, 8 * 1024, 'game options');
    this.rules = rules;
    this.players = cloneJson(players);
    this.seed = normalizeSeed(seed);
    this.options = cloneJson(options);
    this.package = Object.freeze({ id: packageId, version: packageVersion, digest: packageDigest });
    this.environment = Object.freeze({
      locale,
      theme,
      audio: true,
      safeArea: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
    });
    this.revision = 0;
    this.state = undefined;
    this.random = new SeededRandom(this.seed);
    this.connections = new Map();
    this.storageBySeat = new Map();
    this.requestId = 0;
    this.replay = [];
    this.queue = Promise.resolve();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return this;
    const randomState = this.random.state;
    try {
      const state = await this.rules.create({
        seed: this.seed,
        players: cloneJson(this.players),
        options: cloneJson(this.options),
        random: this.random.interface,
      });
      assertSizedJson(state, RUNTIME_LIMITS.stateBytes, 'authority state');
      this.state = cloneJson(state);
      this.initialized = true;
    } catch (error) {
      this.random.state = randomState;
      throw error;
    }
    return this;
  }

  async attachSeat(seat, port) {
    await this.initialize();
    const player = this.playerForSeat(seat);
    if (this.connections.has(seat)) throw new Error(`Seat ${seat} is already attached`);
    const connection = {
      port,
      unbind: bindMessagePort(port, (message) => {
        this.#handleMessage(seat, message).catch((error) => {
          this.#post(seat, bridgeMessage('error', {
            callId: message?.callId,
            message: safeError(error),
          }));
        });
      }),
    };
    this.connections.set(seat, connection);
    this.#post(seat, bridgeMessage('context', {
      context: {
        playerId: player.id,
        seat: player.seat,
        roster: cloneJson(this.players),
        package: this.package,
        mode: 'simulation',
        revision: this.revision,
        environment: this.environment,
      },
    }));
    this.#post(seat, bridgeMessage('roster', { roster: cloneJson(this.players) }));
    this.#post(seat, bridgeMessage('status', { status: 'connected' }));
    await this.#sendView(seat);
  }

  detachSeat(seat) {
    const connection = this.connections.get(seat);
    if (!connection) return;
    connection.unbind?.();
    connection.port.close?.();
    this.connections.delete(seat);
  }

  async dispatchAction(seat, action) {
    const operation = async () => this.#dispatch(seat, action);
    const pending = this.queue.then(operation, operation);
    this.queue = pending.catch(() => {});
    return pending;
  }

  async viewForSeat(seat) {
    await this.initialize();
    const player = this.playerForSeat(seat);
    const view = await this.rules.view({
      state: cloneJson(this.state),
      viewer: player.id,
      players: cloneJson(this.players),
      revision: this.revision,
    });
    assertSizedJson(view, RUNTIME_LIMITS.viewBytes, `seat ${seat} view`);
    return cloneJson(view);
  }

  stateSnapshot() {
    if (!this.initialized) throw new Error('Simulation host is not initialized');
    return cloneJson(this.state);
  }

  replaySnapshot() {
    return cloneJson({
      formatVersion: 1,
      package: this.package,
      seed: this.seed,
      players: this.players,
      options: this.options,
      revision: this.revision,
      actions: this.replay,
    });
  }

  playerForSeat(seat) {
    if (!Number.isInteger(seat)) throw new Error('Seat must be an integer');
    const player = this.players.find((candidate) => candidate.seat === seat);
    if (!player) throw new Error(`Seat ${seat} is not in this game`);
    return player;
  }

  async #dispatch(seat, action) {
    await this.initialize();
    const player = this.playerForSeat(seat);
    assertSizedJson(action, RUNTIME_LIMITS.actionBytes, 'game action');
    this.requestId += 1;
    const randomState = this.random.state;
    let result;
    try {
      result = await this.rules.reduce({
        state: cloneJson(this.state),
        playerId: player.id,
        action: cloneJson(action),
        revision: this.revision,
        requestId: this.requestId,
        random: this.random.interface,
      });
    } catch (error) {
      this.random.state = randomState;
      throw error;
    }
    if (result === null || typeof result !== 'object' || typeof result.accepted !== 'boolean') {
      throw new Error('rules.reduce() must return an accepted result object');
    }
    if (!result.accepted) {
      this.random.state = randomState;
      const rejected = { accepted: false, reason: typeof result.reason === 'string' ? result.reason : 'Action rejected', revision: this.revision };
      this.replay.push(cloneJson({ seat, playerId: player.id, action, result: rejected }));
      return rejected;
    }
    assertSizedJson(result.state, RUNTIME_LIMITS.stateBytes, 'authority state');
    const events = result.events ?? [];
    if (!Array.isArray(events)) throw new Error('rules.reduce().events must be an array');
    for (const event of events) assertSizedJson(event, RUNTIME_LIMITS.eventBytes, 'presentation event');
    this.state = cloneJson(result.state);
    this.revision += 1;
    await this.#broadcastViews();
    for (const event of events) this.#broadcast(bridgeMessage('event', { event: cloneJson(event), revision: this.revision }));
    const accepted = { accepted: true, revision: this.revision };
    this.replay.push(cloneJson({ seat, playerId: player.id, action, result: accepted }));
    return accepted;
  }

  async #handleMessage(seat, raw) {
    const message = assertBridgeMessage(raw);
    if (message.type === 'action') {
      const result = await this.dispatchAction(seat, message.action);
      this.#post(seat, bridgeMessage('actionResult', { callId: message.callId, ...result }));
      return;
    }
    if (message.type === 'storage') {
      const result = this.#storageOperation(seat, message.operation, message.key, message.value);
      this.#post(seat, bridgeMessage('storageResult', { callId: message.callId, result }));
      return;
    }
    throw new Error(`Unsupported game-to-host message: ${message.type}`);
  }

  #storageOperation(seat, operation, key, value) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(key)) throw new Error('Storage key is invalid');
    const storage = this.storageBySeat.get(seat) ?? new Map();
    this.storageBySeat.set(seat, storage);
    if (operation === 'get') return storage.has(key) ? cloneJson(storage.get(key)) : null;
    if (operation === 'remove') {
      storage.delete(key);
      return null;
    }
    if (operation !== 'set') throw new Error(`Unsupported storage operation: ${operation}`);
    assertJsonValue(value, 'storage value');
    const candidate = new Map(storage);
    candidate.set(key, cloneJson(value));
    const bytes = [...candidate].reduce((sum, [entryKey, entryValue]) => sum + encoder.encode(entryKey).length + encodedLength(entryValue), 0);
    if (bytes > RUNTIME_LIMITS.storageBytes) throw new Error('Package storage quota exceeded');
    storage.set(key, cloneJson(value));
    return null;
  }

  async #sendView(seat) {
    const view = await this.viewForSeat(seat);
    this.#post(seat, bridgeMessage('view', { view, revision: this.revision }));
  }

  async #broadcastViews() {
    await Promise.all([...this.connections.keys()].map((seat) => this.#sendView(seat)));
  }

  #post(seat, message) {
    this.connections.get(seat)?.port.postMessage(message);
  }

  #broadcast(message) {
    for (const connection of this.connections.values()) connection.port.postMessage(message);
  }
}

export function createPlayers(count) {
  if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error('Simulation player count must be from 1 through 8');
  return Array.from({ length: count }, (_, index) => ({
    id: `player-${index + 1}`,
    seat: index + 1,
    name: `Player ${index + 1}`,
  }));
}

function validateRules(rules) {
  if (!rules || ['create', 'reduce', 'view'].some((name) => typeof rules[name] !== 'function')) {
    throw new Error('Rules module must export create(), reduce(), and view()');
  }
}

function validatePlayers(players) {
  if (!Array.isArray(players) || players.length < 1 || players.length > 8) throw new Error('Rules require 1 through 8 local players');
  const ids = new Set();
  const seats = new Set();
  for (const player of players) {
    if (!player || typeof player.id !== 'string' || typeof player.name !== 'string' || !Number.isInteger(player.seat)) {
      throw new Error('Player records require id, name, and integer seat');
    }
    if (ids.has(player.id) || seats.has(player.seat) || player.seat < 1 || player.seat > 8) throw new Error('Player ids and seats must be unique');
    ids.add(player.id);
    seats.add(player.seat);
  }
}

function normalizeSeed(seed) {
  if (!Number.isSafeInteger(seed)) throw new Error('Simulation seed must be a safe integer');
  return seed >>> 0;
}

function assertSizedJson(value, limit, label) {
  assertJsonValue(value, label);
  const length = encodedLength(value);
  if (length > limit) throw new Error(`${label} is ${length} bytes; limit is ${limit}`);
}

function encodedLength(value) {
  return encoder.encode(canonicalJson(value)).length;
}

function cloneJson(value) {
  return structuredClone(value);
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

class SeededRandom {
  constructor(seed) {
    this.state = seed || 0x6d2b79f5;
    this.interface = Object.freeze({
      nextFloat: () => this.nextFloat(),
      nextInt: (maximum) => this.nextInt(maximum),
    });
  }

  nextFloat() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  }

  nextInt(maximum) {
    if (!Number.isInteger(maximum) || maximum <= 0) throw new Error('Random integer maximum must be positive');
    return Math.floor(this.nextFloat() * maximum);
  }
}
