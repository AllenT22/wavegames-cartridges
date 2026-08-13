import { installAuthoritativeDeterminismGuard } from '/__wavegames/sdk/determinism-guard.mjs';
import { createPlayers, SimulationHost } from '/__wavegames/sdk/simulation-host.mjs';

let host;

installAuthoritativeDeterminismGuard();

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || !Number.isSafeInteger(message.id) || typeof message.type !== 'string') return;
  handle(message).then(
    (value) => self.postMessage({ id: message.id, ok: true, value }),
    (error) => self.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
});

async function handle(message) {
  if (message.type === 'initialize') {
    const rules = await import(message.rulesUrl);
    host = new SimulationHost({
      rules,
      players: createPlayers(message.playerCount),
      seed: message.seed,
      packageId: message.packageId,
      packageVersion: message.packageVersion,
      packageDigest: message.packageDigest,
    });
    await host.initialize();
    return { revision: host.revision };
  }
  if (!host) throw new Error('Rules worker has not been initialized');
  if (message.type === 'attach') {
    if (!(message.port instanceof MessagePort)) throw new Error('Attach requires a MessagePort');
    await host.attachSeat(message.seat, message.port);
    return null;
  }
  if (message.type === 'detach') {
    host.detachSeat(message.seat);
    return null;
  }
  if (message.type === 'replay') return host.replaySnapshot();
  throw new Error(`Unknown rules-worker operation: ${message.type}`);
}
