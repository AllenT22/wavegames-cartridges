import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStrictJson } from '../src/json.mjs';
import { validateManifest } from '../src/manifest.mjs';
import { assertNoPathCollisions, comparePackagePaths, normalizePackagePath } from '../src/paths.mjs';
import { validManifest } from './helpers.mjs';

test('manifest validator accepts the exact flat Cartridge API 1 shape', () => {
  const manifest = validateManifest(validManifest());
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.engineApi, 1);
  assert.deepEqual(manifest.capabilities, ['storage', 'audio']);
  assert.equal(manifest.modes.local.minPlayers, 1);
});

test('manifest validator rejects unknown, legacy, and unsupported fields', () => {
  assert.throws(() => validateManifest(validManifest({ extra: true })), /unknown field extra/);
  const legacy = validManifest();
  delete legacy.formatVersion;
  legacy.schemaVersion = 1;
  assert.throws(() => validateManifest(legacy), /unknown field schemaVersion/);
  assert.throws(() => validateManifest(validManifest({ engineApi: 2 })), /engineApi/);
  assert.throws(() => validateManifest(validManifest({ icon: undefined })), /icon/);
});

test('manifest validator matches Dart identifier, locale, text, and capability limits', () => {
  assert.throws(() => validateManifest(validManifest({ id: 'wave-games.example.demo' })), /reverse-domain/);
  assert.throws(() => validateManifest(validManifest({ id: `a.${'b'.repeat(46)}.c` })), /48/);
  assert.throws(() => validateManifest(validManifest({ title: { 'en-us': 'bad' } })), /locale/);
  assert.throws(() => validateManifest(validManifest({ title: { en: 'x'.repeat(81) } })), /80/);
  assert.throws(() => validateManifest(validManifest({ description: { en: 'x'.repeat(241) } })), /240/);
  assert.throws(() => validateManifest(validManifest({ capabilities: ['network'] })), /Unsupported/);
  assert.throws(() => validateManifest(validManifest({ capabilities: ['audio', 'audio'] })), /Duplicate/);
});

test('manifest validator enforces local 1-8 and Wave 2-8 ranges', () => {
  assert.doesNotThrow(() => validateManifest(validManifest({ modes: { local: { minPlayers: 1, maxPlayers: 1 } } })));
  assert.throws(() => validateManifest(validManifest({ modes: { local: { minPlayers: 0, maxPlayers: 1 } } })), /1 through 8/);
  assert.throws(() => validateManifest(validManifest({ modes: { wave: { minPlayers: 1, maxPlayers: 2, pace: 'turn-based' } } })), /2 through 8/);
  assert.throws(() => validateManifest(validManifest({ modes: { wave: { minPlayers: 2, maxPlayers: 2, pace: 'real-time' } } })), /turn-based/);
  assert.throws(() => validateManifest(validManifest({ modes: {} })), /must define/);
});

test('strict JSON rejects duplicate keys and preserves Dart integer semantics', () => {
  assert.throws(() => parseStrictJson('{"id":1,"id":2}'), /duplicate key/);
  const decimalVersion = parseStrictJson(JSON.stringify(validManifest()).replace('"formatVersion":1', '"formatVersion":1.0'));
  assert.throws(() => validateManifest(decimalVersion), /formatVersion/);
  const decimalPlayers = parseStrictJson(JSON.stringify(validManifest()).replace('"minPlayers":1', '"minPlayers":1e0'));
  assert.throws(() => validateManifest(decimalPlayers), /minPlayers/);
  assert.throws(() => parseStrictJson(`${'['.repeat(33)}0${']'.repeat(33)}`), /depth 32/);
});

test('package paths are relative, bounded portable ASCII sorted like Dart', () => {
  assert.equal(normalizePackagePath('ui/game-board_2.html'), 'ui/game-board_2.html');
  assert.throws(() => normalizePackagePath('ui/日本語.html'), /portable ASCII/);
  assert.throws(() => normalizePackagePath('../secret'), /unsafe/);
  assert.throws(() => normalizePackagePath('C:/secret'), /relative/);
  assert.throws(() => normalizePackagePath('/secret'), /relative/);
  assert.throws(() => normalizePackagePath(`a/${'界'.repeat(85)}/z`), /too long/);
  assert.throws(() => assertNoPathCollisions(['UI/index.html', 'ui/index.html']), /collide/);
  assert.equal(comparePackagePaths('a', 'ä') < 0, true);
});
