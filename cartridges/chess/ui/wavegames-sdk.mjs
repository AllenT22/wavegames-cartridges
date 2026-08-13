// Self-contained Cartridge API 1 client. Copy this file into each cartridge.
const API_VERSION = 1;
const ATTACH_MESSAGE = 'wavegames:attach';
const CLIENT_READY_MESSAGE = 'wavegames:client-ready';
const RUNTIME_READY_EVENT = 'wavegames:runtime-ready';

export class GameClient {
  constructor(port) {
    this.port = port;
    this.context = null;
    this.view = null;
    this.revision = 0;
    this.roster = [];
    this.status = 'connecting';
    this.listeners = new Map();
    this.pending = new Map();
    this.callId = 0;
    this.unbind = bindMessagePort(port, (message) => this.#receive(message));
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
  }

  onView(listener) { return this.on('view', listener); }
  onRoster(listener) { return this.on('roster', listener); }
  onStatus(listener) { return this.on('status', listener); }
  onEvent(listener) { return this.on('event', listener); }

  on(type, listener) {
    if (typeof listener !== 'function') throw new Error('Bridge listener must be a function');
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    return () => listeners.delete(listener);
  }

  async sendAction(action) {
    await this.ready;
    return this.#request('action', { action });
  }

  storage = Object.freeze({
    get: async (key) => { await this.ready; return this.#request('storage', { operation: 'get', key }); },
    set: async (key, value) => { await this.ready; return this.#request('storage', { operation: 'set', key, value }); },
    remove: async (key) => { await this.ready; return this.#request('storage', { operation: 'remove', key }); },
  });

  close() {
    this.unbind?.();
    this.port.close?.();
    for (const { reject } of this.pending.values()) reject(new Error('Wave Games bridge closed'));
    this.pending.clear();
  }

  #request(type, fields) {
    this.callId += 1;
    const callId = this.callId;
    return new Promise((resolve, reject) => {
      this.pending.set(callId, { resolve, reject });
      this.port.postMessage(message(type, { callId, ...fields }));
    });
  }

  #receive(raw) {
    let incoming;
    try {
      incoming = assertMessage(raw);
    } catch (error) {
      this.rejectReady?.(error);
      return;
    }
    if (incoming.type === 'context') {
      this.context = Object.freeze(incoming.context);
      this.revision = incoming.context.revision;
      this.resolveReady?.(this);
      this.#emit('context', this.context);
      return;
    }
    if (incoming.type === 'view') {
      this.view = incoming.view;
      this.revision = incoming.revision;
      this.#emit('view', this.view, this.revision);
      return;
    }
    if (incoming.type === 'roster') {
      this.roster = incoming.roster;
      this.#emit('roster', this.roster);
      return;
    }
    if (incoming.type === 'status') {
      this.status = incoming.status;
      this.#emit('status', this.status);
      return;
    }
    if (incoming.type === 'event') {
      this.#emit('event', incoming.event, incoming.revision);
      return;
    }
    if (incoming.type === 'error' && incoming.callId === undefined) {
      this.#emit('error', incoming.message);
      return;
    }
    if (incoming.type === 'actionResult' || incoming.type === 'storageResult' || incoming.type === 'error') {
      const pending = this.pending.get(incoming.callId);
      if (!pending) return;
      this.pending.delete(incoming.callId);
      if (incoming.type === 'error') pending.reject(new Error(incoming.message));
      else if (incoming.type === 'storageResult') pending.resolve(incoming.result);
      else pending.resolve({ accepted: incoming.accepted, reason: incoming.reason, revision: incoming.revision });
    }
  }

  #emit(type, ...arguments_) {
    for (const listener of this.listeners.get(type) ?? []) listener(...arguments_);
  }
}

export function connect({ api = API_VERSION, timeoutMs = 10_000 } = {}) {
  if (api !== API_VERSION) return Promise.reject(new Error(`Wave Games bridge API ${api} is not supported`));
  if (typeof window === 'undefined') return Promise.reject(new Error('WaveGames.connect() requires a browser cartridge context'));
  const injected = nativeRuntime();
  if (injected) return connectNative(injected, api);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (operation, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      operation(value);
    };
    const attach = (event) => {
      if (event.source !== window.parent || event.data?.type !== ATTACH_MESSAGE || event.data?.api !== API_VERSION || event.ports.length !== 1) return;
      const client = new GameClient(event.ports[0]);
      client.ready.then(
        () => finish(resolve, client),
        (error) => finish(reject, error),
      );
    };
    const nativeReady = () => {
      const runtime = nativeRuntime();
      if (!runtime) {
        finish(reject, new Error(`${RUNTIME_READY_EVENT} fired without window.WaveGames.connect()`));
        return;
      }
      connectNative(runtime, api).then(
        (session) => finish(resolve, session),
        (error) => finish(reject, error),
      );
    };
    const timeout = window.setTimeout(
      () => finish(reject, new Error('Timed out waiting for the Wave Games host')),
      timeoutMs,
    );
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', attach);
      window.removeEventListener(RUNTIME_READY_EVENT, nativeReady);
    };
    window.addEventListener('message', attach);
    window.addEventListener(RUNTIME_READY_EVENT, nativeReady, { once: true });
    if (window.parent !== window) {
      window.parent.postMessage({ type: CLIENT_READY_MESSAGE, api: API_VERSION }, '*');
    }
  });
}

export const WaveGames = Object.freeze({ connect });

function nativeRuntime() {
  const runtime = window.WaveGames;
  return runtime && runtime !== WaveGames && typeof runtime.connect === 'function' ? runtime : null;
}

async function connectNative(runtime, api) {
  const session = await runtime.connect({ api });
  validateNativeSession(session);
  return session;
}

function validateNativeSession(session) {
  if (!session || typeof session !== 'object' || !session.context || typeof session.sendAction !== 'function') {
    throw new Error('Native WaveGames.connect() returned an invalid session');
  }
  for (const listener of ['onView', 'onRoster', 'onStatus']) {
    if (typeof session[listener] !== 'function') throw new Error(`Native Wave Games session is missing ${listener}()`);
  }
  if (!session.storage || ['get', 'set', 'remove'].some((name) => typeof session.storage[name] !== 'function')) {
    throw new Error('Native Wave Games session is missing storage methods');
  }
}

function message(type, fields = {}) {
  return { api: API_VERSION, type, ...fields };
}

function assertMessage(incoming) {
  if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw new Error('Wave Games bridge message must be an object');
  }
  if (incoming.api !== API_VERSION || typeof incoming.type !== 'string') {
    throw new Error('Wave Games bridge message has an unsupported API or type');
  }
  return incoming;
}

function bindMessagePort(port, handler) {
  if (!port || typeof port.postMessage !== 'function') throw new Error('A MessagePort-compatible transport is required');
  if (typeof port.addEventListener === 'function') {
    const listener = (event) => handler(event.data);
    port.addEventListener('message', listener);
    port.start?.();
    return () => port.removeEventListener('message', listener);
  }
  if (typeof port.on === 'function') {
    port.on('message', handler);
    return () => port.off?.('message', handler);
  }
  throw new Error('Message transport cannot receive messages');
}
