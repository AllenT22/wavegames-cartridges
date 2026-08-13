import { ATTACH_MESSAGE, BRIDGE_API_VERSION } from '/__wavegames/sdk/protocol.mjs';

const config = await fetch('/__wavegames/config.json').then((response) => response.json());
const manifest = config.manifest;
const title = manifest.title.en ?? Object.values(manifest.title)[0];
document.querySelector('#title').textContent = title;
document.querySelector('#package').textContent = `${manifest.id} · ${manifest.version} · ${config.packageDigest.slice(0, 12)}`;

const mode = manifest.modes.local ?? manifest.modes.wave;
const playerSelect = document.querySelector('#players');
for (let count = 1; count <= 8; count += 1) {
  const option = document.createElement('option');
  option.value = String(count);
  option.textContent = String(count);
  option.disabled = count < mode.minPlayers || count > mode.maxPlayers;
  option.selected = count === mode.minPlayers;
  playerSelect.append(option);
}

let host;
const frames = new Map();
let faults;
window.addEventListener('message', (event) => {
  if (event.data?.type !== 'wavegames:client-ready' || event.data?.api !== 1 || !host) return;
  const seat = [...frames].find(([, record]) => record.frame.contentWindow === event.source)?.[0];
  if (seat === undefined || frames.get(seat).connected) return;
  attachFrame(seat, frames.get(seat)).catch(showError);
});
document.querySelector('#controls').addEventListener('submit', (event) => {
  event.preventDefault();
  start().catch(showError);
});
document.querySelector('#copy-replay').addEventListener('click', () => copyReplay().catch(showError));
document.querySelector('#drop-next').addEventListener('click', (event) => faults.arm('drop', event.currentTarget));
document.querySelector('#duplicate-next').addEventListener('click', (event) => faults.arm('duplicate', event.currentTarget));
document.querySelector('#reorder-next').addEventListener('click', (event) => faults.arm('reorder', event.currentTarget));

async function start() {
  document.querySelector('#error').hidden = true;
  host?.close();
  for (const record of frames.values()) record.relay?.close();
  const playerCount = Number(playerSelect.value);
  const seed = Number(document.querySelector('#seed').value);
  const rulesUrl = `/cartridge/${manifest.entrypoints.rules}?simulation=${Date.now()}`;
  const nextHost = new RulesWorkerClient();
  await nextHost.initialize({
    rulesUrl,
    playerCount,
    seed,
    packageId: manifest.id,
    packageVersion: manifest.version,
    packageDigest: config.packageDigest,
  });
  host = nextHost;
  const seats = document.querySelector('#seats');
  seats.replaceChildren();
  frames.clear();
  for (let seat = 1; seat <= playerCount; seat += 1) {
    const panel = document.createElement('section');
    panel.className = 'seat';
    const headingBar = document.createElement('div');
    headingBar.className = 'seat-heading';
    const heading = document.createElement('h2');
    heading.textContent = `Seat ${seat} · Player ${seat}`;
    const connection = document.createElement('button');
    connection.type = 'button';
    connection.className = 'secondary';
    connection.textContent = 'Disconnect';
    const frame = document.createElement('iframe');
    frame.title = `Cartridge view for seat ${seat}`;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.src = `/cartridge/${manifest.entrypoints.ui}?seat=${seat}&run=${Date.now()}`;
    const record = { frame, connection, connected: false };
    frames.set(seat, record);
    connection.addEventListener('click', () => toggleSeat(seat, record));
    headingBar.append(heading, connection);
    panel.append(headingBar, frame);
    seats.append(panel);
  }
}

async function attachFrame(seat, record) {
  const cartridgeChannel = new MessageChannel();
  const workerChannel = new MessageChannel();
  record.relay = new PortRelay(cartridgeChannel.port1, workerChannel.port1, faults);
  await host.attachSeat(seat, workerChannel.port2);
  record.frame.contentWindow.postMessage(
    { type: ATTACH_MESSAGE, api: BRIDGE_API_VERSION, seat },
    '*',
    [cartridgeChannel.port2],
  );
  record.connected = true;
  record.connection.textContent = 'Disconnect';
}

async function toggleSeat(seat, record) {
  if (record.connected) {
    await host.detachSeat(seat);
    record.relay?.close();
    record.relay = null;
    record.connected = false;
    record.connection.textContent = 'Reconnect';
    record.frame.src = 'about:blank';
    return;
  }
  record.connection.disabled = true;
  record.frame.src = `/cartridge/${manifest.entrypoints.ui}?seat=${seat}&run=${Date.now()}`;
  record.connection.disabled = false;
}

async function copyReplay() {
  if (!host) return;
  const replay = JSON.stringify(await host.replaySnapshot(), null, 2);
  await navigator.clipboard.writeText(replay);
  const button = document.querySelector('#copy-replay');
  const prior = button.textContent;
  button.textContent = 'Replay copied';
  window.setTimeout(() => { button.textContent = prior; }, 1200);
}

function showError(error) {
  const output = document.querySelector('#error');
  output.textContent = error instanceof Error ? error.message : String(error);
  output.hidden = false;
}

class FaultInjector {
  constructor() {
    this.drop = null;
    this.duplicate = null;
    this.reorder = null;
    this.held = null;
  }

  arm(kind, button) {
    this[kind]?.removeAttribute('data-active');
    this[kind] = button;
    button.dataset.active = 'true';
  }

  forward(deliver) {
    if (this.drop) {
      this.#consume('drop');
      return;
    }
    if (this.reorder) {
      if (!this.held) {
        this.held = deliver;
        window.setTimeout(() => this.#flushHeld(), 400);
        return;
      }
      const held = this.held;
      this.held = null;
      this.#consume('reorder');
      this.#schedule(deliver);
      this.#schedule(held, 20);
      return;
    }
    const duplicate = Boolean(this.duplicate);
    if (duplicate) this.#consume('duplicate');
    this.#schedule(deliver);
    if (duplicate) this.#schedule(deliver, 20);
  }

  #flushHeld() {
    if (!this.held) return;
    const held = this.held;
    this.held = null;
    this.#consume('reorder');
    this.#schedule(held);
  }

  #consume(kind) {
    this[kind]?.removeAttribute('data-active');
    this[kind] = null;
  }

  #schedule(deliver, extra = 0) {
    const delay = Math.max(0, Math.min(5000, Number(document.querySelector('#delay').value) || 0));
    window.setTimeout(deliver, delay + extra);
  }
}

class PortRelay {
  constructor(cartridgePort, workerPort, injector) {
    this.cartridgePort = cartridgePort;
    this.workerPort = workerPort;
    this.injector = injector;
    this.fromCartridge = (event) => this.#forward(this.workerPort, event.data);
    this.fromWorker = (event) => this.#forward(this.cartridgePort, event.data);
    cartridgePort.addEventListener('message', this.fromCartridge);
    workerPort.addEventListener('message', this.fromWorker);
    cartridgePort.start();
    workerPort.start();
  }

  #forward(destination, message) {
    const copy = structuredClone(message);
    this.injector.forward(() => destination.postMessage(copy));
  }

  close() {
    this.cartridgePort.removeEventListener('message', this.fromCartridge);
    this.workerPort.removeEventListener('message', this.fromWorker);
    this.cartridgePort.close();
    this.workerPort.close();
  }
}

class RulesWorkerClient {
  constructor() {
    this.worker = new Worker('/rules-worker.mjs', { type: 'module', name: 'wavegames-rules' });
    this.pending = new Map();
    this.nextId = 0;
    this.worker.addEventListener('message', (event) => {
      const response = event.data;
      const pending = this.pending.get(response?.id);
      if (!pending) return;
      this.pending.delete(response.id);
      window.clearTimeout(pending.timeout);
      if (response.ok) pending.resolve(response.value);
      else pending.reject(new Error(response.error || 'Rules worker failed'));
    });
    this.worker.addEventListener('error', (event) => {
      this.#rejectAll(new Error(event.message || 'Rules worker crashed'));
    });
  }

  initialize(configuration) { return this.#request('initialize', configuration); }

  attachSeat(seat, port) { return this.#request('attach', { seat, port }, [port]); }

  detachSeat(seat) { return this.#request('detach', { seat }); }

  replaySnapshot() { return this.#request('replay'); }

  close() {
    this.worker.terminate();
    this.#rejectAll(new Error('Rules worker restarted'));
  }

  #request(type, fields = {}, transfer = []) {
    this.nextId += 1;
    const id = this.nextId;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Rules worker ${type} timed out`));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.worker.postMessage({ id, type, ...fields }, transfer);
    });
  }

  #rejectAll(error) {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

faults = new FaultInjector();
await start();
