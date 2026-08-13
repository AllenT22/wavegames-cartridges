import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function temporaryDirectory(prefix = 'wavegame-test-') {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  return {
    root,
    resolve: (...segments) => path.join(root, ...segments),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export function validManifest(overrides = {}) {
  return {
    formatVersion: 1,
    id: 'games.example.test-game',
    version: '1.2.3',
    title: { en: 'Test Game' },
    description: { en: 'A test cartridge.' },
    icon: 'assets/icon.svg',
    engineApi: 1,
    entrypoints: { rules: 'rules/index.mjs', ui: 'ui/index.html' },
    orientation: 'any',
    capabilities: ['storage', 'audio'],
    modes: {
      local: { minPlayers: 1, maxPlayers: 8 },
      wave: { minPlayers: 2, maxPlayers: 8, pace: 'turn-based' },
    },
    ...overrides,
  };
}
