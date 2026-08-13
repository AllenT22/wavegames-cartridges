import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCartridgeForSimulator } from '../src/testing.mjs';
import { normalizePackagePath } from '../src/paths.mjs';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const simulatorRoot = path.join(toolRoot, 'simulator');

export async function startSimulator(inputPath, { host = '127.0.0.1', port = 0 } = {}) {
  const loaded = await loadCartridgeForSimulator(inputPath);
  const server = createServer((request, response) => {
    routeRequest(request, response, loaded).catch((error) => {
      response.writeHead(error?.code === 'ENOENT' ? 404 : 400, securityHeaders('text/plain; charset=utf-8'));
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
  } catch (error) {
    await loaded.cleanup();
    throw error;
  }
  const address = server.address();
  const url = `http://${host}:${address.port}/`;
  return {
    url,
    summary: loaded.summary,
    close: async () => {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await loaded.cleanup();
    },
  };
}

async function routeRequest(request, response, loaded) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, securityHeaders('text/plain; charset=utf-8'));
    response.end('Method not allowed');
    return;
  }
  const url = new URL(request.url, 'http://wavegames.local');
  if (url.pathname === '/__wavegames/config.json') {
    return send(response, Buffer.from(JSON.stringify({
      manifest: loaded.summary.manifest,
      packageDigest: loaded.summary.packageDigest,
    })), 'application/json; charset=utf-8', request.method);
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return sendFile(response, path.join(simulatorRoot, 'index.html'), request.method);
  }
  if (url.pathname === '/app.mjs' || url.pathname === '/rules-worker.mjs' || url.pathname === '/styles.css') {
    return sendFile(response, path.join(simulatorRoot, url.pathname.slice(1)), request.method);
  }
  if (url.pathname.startsWith('/cartridge/')) {
    const entryPath = normalizePackagePath(decodeURIComponent(url.pathname.slice('/cartridge/'.length)));
    const destination = safeJoin(loaded.root, entryPath);
    return sendFile(response, destination, request.method);
  }
  if (url.pathname.startsWith('/__wavegames/')) {
    const entryPath = normalizePackagePath(decodeURIComponent(url.pathname.slice('/__wavegames/'.length)));
    const allowed = entryPath.startsWith('sdk/') || entryPath === 'src/json.mjs' || entryPath === 'src/constants.mjs';
    if (!allowed) throw new Error('Tool module is not exposed to cartridges');
    return sendFile(response, safeJoin(toolRoot, entryPath), request.method);
  }
  response.writeHead(404, securityHeaders('text/plain; charset=utf-8'));
  response.end('Not found');
}

async function sendFile(response, filePath, method) {
  const data = await readFile(filePath);
  return send(response, data, mimeType(filePath), method);
}

function send(response, data, contentType, method) {
  response.writeHead(200, {
    ...securityHeaders(contentType),
    'Cache-Control': 'no-store',
    'Content-Length': data.length,
  });
  response.end(method === 'HEAD' ? undefined : data);
}

function securityHeaders(contentType) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': contentType,
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

function safeJoin(root, entryPath) {
  const destination = path.resolve(root, ...entryPath.split('/'));
  if (!destination.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Unsafe file path');
  return destination;
}

function mimeType(filePath) {
  return {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.webp': 'image/webp',
  }[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}
