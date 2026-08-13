export const BRIDGE_API_VERSION = 1;
export const ATTACH_MESSAGE = 'wavegames:attach';

export function bridgeMessage(type, fields = {}) {
  return { api: BRIDGE_API_VERSION, type, ...fields };
}

export function assertBridgeMessage(message) {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    throw new Error('Wave Games bridge message must be an object');
  }
  if (message.api !== BRIDGE_API_VERSION || typeof message.type !== 'string') {
    throw new Error('Wave Games bridge message has an unsupported API or type');
  }
  return message;
}

export function bindMessagePort(port, handler) {
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
