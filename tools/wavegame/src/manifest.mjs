import {
  ENGINE_API_VERSION,
  PACKAGE_SCHEMA_VERSION,
  SAFE_CAPABILITIES,
} from './constants.mjs';
import { normalizePackagePath } from './paths.mjs';

const identifierPattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*){2,}$/;
const semanticVersionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const localePattern = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-[0-9]{3})?$/;
const allowedCapabilities = new Set(SAFE_CAPABILITIES);

export function validateManifest(manifest) {
  assertObject(manifest, 'manifest');
  assertKeys(
    manifest,
    ['formatVersion', 'id', 'version', 'title', 'description', 'icon', 'engineApi', 'entrypoints', 'orientation', 'capabilities', 'modes'],
    ['formatVersion', 'id', 'version', 'title', 'icon', 'engineApi', 'entrypoints', 'orientation', 'capabilities', 'modes'],
    'manifest',
  );
  if (manifest.formatVersion !== PACKAGE_SCHEMA_VERSION) throw new Error(`manifest.formatVersion must be ${PACKAGE_SCHEMA_VERSION}`);
  assertString(manifest.id, 'manifest.id', 48);
  if (!identifierPattern.test(manifest.id)) throw new Error('manifest.id must be a lowercase reverse-domain identifier with at least three segments');
  assertString(manifest.version, 'manifest.version', 64);
  if (!semanticVersionPattern.test(manifest.version)) throw new Error('manifest.version must be a semantic version');
  validateLocalizedText(manifest.title, 'manifest.title', 80);
  if (manifest.description !== undefined) validateLocalizedText(manifest.description, 'manifest.description', 240);
  if (manifest.engineApi !== ENGINE_API_VERSION) throw new Error(`manifest.engineApi must be ${ENGINE_API_VERSION}`);

  assertObject(manifest.entrypoints, 'manifest.entrypoints');
  assertKeys(manifest.entrypoints, ['rules', 'ui'], ['rules', 'ui'], 'manifest.entrypoints');
  for (const key of ['rules', 'ui']) {
    manifest.entrypoints[key] = normalizePackagePath(manifest.entrypoints[key]);
  }
  if (!manifest.entrypoints.rules.endsWith('.mjs')) throw new Error('manifest.entrypoints.rules must point to an .mjs module');
  if (!manifest.entrypoints.ui.endsWith('.html')) throw new Error('manifest.entrypoints.ui must point to an .html document');
  assertString(manifest.icon, 'manifest.icon', 255);
  manifest.icon = normalizePackagePath(manifest.icon);

  if (!['any', 'portrait', 'landscape'].includes(manifest.orientation)) {
    throw new Error('manifest.orientation must be any, portrait, or landscape');
  }
  if (!Array.isArray(manifest.capabilities)) throw new Error('manifest.capabilities must be an array');
  const capabilities = new Set();
  for (const capability of manifest.capabilities) {
    if (!allowedCapabilities.has(capability)) throw new Error(`Unsupported safe capability: ${capability}`);
    if (capabilities.has(capability)) throw new Error(`Duplicate capability: ${capability}`);
    capabilities.add(capability);
  }

  assertObject(manifest.modes, 'manifest.modes');
  assertKeys(manifest.modes, ['local', 'wave'], [], 'manifest.modes');
  if (manifest.modes.local === undefined && manifest.modes.wave === undefined) {
    throw new Error('manifest.modes must define local and/or wave');
  }
  if (manifest.modes.local !== undefined) validatePlayerMode(manifest.modes.local, 'manifest.modes.local', false);
  if (manifest.modes.wave !== undefined) validatePlayerMode(manifest.modes.wave, 'manifest.modes.wave', true);
  return manifest;
}

function validatePlayerMode(mode, label, wave) {
  assertObject(mode, label);
  assertKeys(mode, wave ? ['minPlayers', 'maxPlayers', 'pace'] : ['minPlayers', 'maxPlayers'], wave ? ['minPlayers', 'maxPlayers', 'pace'] : ['minPlayers', 'maxPlayers'], label);
  for (const key of ['minPlayers', 'maxPlayers']) {
    const minimum = wave ? 2 : 1;
    if (!Number.isInteger(mode[key]) || mode[key] < minimum || mode[key] > 8) throw new Error(`${label}.${key} must be an integer from ${minimum} through 8`);
  }
  if (mode.minPlayers > mode.maxPlayers) throw new Error(`${label}.minPlayers cannot exceed maxPlayers`);
  if (wave && mode.pace !== 'turn-based') throw new Error(`${label}.pace must be turn-based in API 1`);
}

function validateLocalizedText(value, label, maxLength) {
  assertObject(value, label);
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 16) throw new Error(`${label} must contain from 1 through 16 locales`);
  for (const [locale, text] of entries) {
    if (!localePattern.test(locale)) throw new Error(`${label} has invalid locale ${locale}`);
    assertString(text, `${label}.${locale}`, maxLength);
  }
}

function assertObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertString(value, label, maxLength) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string no longer than ${maxLength} characters`);
  }
}

function assertKeys(value, allowed, required, label) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) throw new Error(`${label} contains unknown field ${key}`);
  for (const key of required) if (!Object.hasOwn(value, key)) throw new Error(`${label} is missing required field ${key}`);
}
