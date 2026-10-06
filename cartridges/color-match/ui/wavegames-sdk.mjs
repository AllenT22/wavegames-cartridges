// Self-contained Cartridge API 1 client. Copy this file into each cartridge.
const API_VERSION = 1;
const ATTACH_MESSAGE = 'wavegames:attach';
const CLIENT_READY_MESSAGE = 'wavegames:client-ready';
const RUNTIME_READY_EVENT = 'wavegames:runtime-ready';
const REQUEST_TIMEOUT_MS = 30_000;

export class GameClient {
  constructor(port, { requestTimeoutMs = REQUEST_TIMEOUT_MS, contextTimeoutMs = 10_000 } = {}) {
    assertTimeout(requestTimeoutMs);
    assertTimeout(contextTimeoutMs);
    this.port = port;
    this.requestTimeoutMs = requestTimeoutMs;
    this.closed = false;
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
    this.contextTimer = setTimeout(() => {
      this.rejectReady?.(new Error('Timed out waiting for the WaveGames host'));
      this.close();
    }, contextTimeoutMs);
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
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.contextTimer);
    this.rejectReady?.(new Error('WaveGames bridge closed'));
    this.unbind?.();
    this.port.close?.();
    this.#rejectPending(new Error('WaveGames bridge closed'));
    this.status = 'closed';
    this.#emit('status', this.status);
  }

  #request(type, fields) {
    if (this.closed || unavailable(this.status)) return Promise.reject(new Error('WaveGames host is disconnected'));
    this.callId += 1;
    const callId = this.callId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        reject(new Error('No response from the WaveGames host. Check the current turn before trying again.'));
      }, this.requestTimeoutMs);
      this.pending.set(callId, { resolve, reject, timer });
      try {
        this.port.postMessage(message(type, { callId, ...fields }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(callId);
        reject(error);
      }
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
      clearTimeout(this.contextTimer);
      this.context = Object.freeze(incoming.context);
      this.revision = incoming.context.revision;
      this.resolveReady?.(this);
      this.#emit('context', this.context);
      return;
    }
    if (incoming.type === 'view') {
      if (Number.isSafeInteger(incoming.revision) && incoming.revision < this.revision) return;
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
      if (unavailable(this.status)) this.#rejectPending(new Error('WaveGames host is disconnected'));
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
      clearTimeout(pending.timer);
      if (incoming.type === 'error') pending.reject(new Error(incoming.message));
      else if (incoming.type === 'storageResult') pending.resolve(incoming.result);
      else pending.resolve({ accepted: incoming.accepted, reason: incoming.reason, revision: incoming.revision });
    }
  }

  #emit(type, ...arguments_) {
    for (const listener of this.listeners.get(type) ?? []) listener(...arguments_);
  }

  #rejectPending(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }
}

export function connect({ api = API_VERSION, timeoutMs = 10_000, requestTimeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  try { assertTimeout(timeoutMs); assertTimeout(requestTimeoutMs); } catch (error) { return Promise.reject(error); }
  if (api !== API_VERSION) return Promise.reject(new Error(`Wave Games bridge API ${api} is not supported`));
  if (typeof window === 'undefined') return Promise.reject(new Error('WaveGames.connect() requires a browser cartridge context'));
  const injected = nativeRuntime();
  if (injected) return connectNative(injected, api, timeoutMs, requestTimeoutMs);

  return new Promise((resolve, reject) => {
    let settled = false;
    let client = null;
    const finish = (operation, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (operation === reject) client?.close();
      operation(value);
    };
    const attach = (event) => {
      if (event.source !== window.parent || event.data?.type !== ATTACH_MESSAGE || event.data?.api !== API_VERSION || event.ports.length !== 1) return;
      if (client) { event.ports[0].close?.(); return; }
      client = new GameClient(event.ports[0], { requestTimeoutMs, contextTimeoutMs: timeoutMs });
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
      connectNative(runtime, api, timeoutMs, requestTimeoutMs).then(
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

async function connectNative(runtime, api, timeoutMs, requestTimeoutMs) {
  const session = await deadline(() => runtime.connect({ api }), timeoutMs, 'Timed out waiting for the WaveGames host');
  validateNativeSession(session);
  let status = session.status ?? 'connected';
  let closed = false;
  const pending = new Set();
  const failPending = () => {
    for (const record of pending) record.fail(new Error('WaveGames host is disconnected'));
  };
  const unbind = session.onStatus((next) => {
    status = next;
    if (unavailable(next)) failPending();
  });
  const request = (operation) => {
    if (closed || unavailable(status)) return Promise.reject(new Error('WaveGames host is disconnected'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(record.timer);
        pending.delete(record);
        callback(value);
      };
      const record = { fail: (error) => finish(reject, error) };
      record.timer = setTimeout(() => record.fail(new Error('No response from the WaveGames host. Check the current turn before trying again.')), requestTimeoutMs);
      pending.add(record);
      Promise.resolve().then(() => { if (!settled) return operation(); }).then((value) => finish(resolve, value), record.fail);
    });
  };
  return Object.freeze({
    get context() { return session.context; },
    get view() { return session.view; },
    get revision() { return session.revision; },
    get roster() { return session.roster; },
    get status() { return status; },
    sendAction: (action) => request(() => session.sendAction(action)),
    onView: (listener) => session.onView(listener),
    onRoster: (listener) => session.onRoster(listener),
    onStatus: (listener) => session.onStatus(listener),
    onEvent: (listener) => session.onEvent?.(listener) ?? (() => {}),
    storage: Object.freeze({
      get: (key) => request(() => session.storage.get(key)),
      set: (key, value) => request(() => session.storage.set(key, value)),
      remove: (key) => request(() => session.storage.remove(key)),
    }),
    close() { closed = true; unbind?.(); failPending(); session.close?.(); },
  });
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

function unavailable(status) {
  return ['recovering', 'disconnected', 'ended', 'closed', 'error'].includes(status);
}

function assertTimeout(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 300_000) throw new Error('Bridge timeout must be between 1 and 300000ms');
}

function deadline(operation, timeoutMs, detail) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(detail)), timeoutMs);
    Promise.resolve().then(operation).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
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
