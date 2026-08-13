export const MANIFEST_PATH = 'wavegame.json';
export const FILES_INDEX_PATH = 'META-INF/files.json';

export const PACKAGE_LIMITS = Object.freeze({
  archiveBytes: 25 * 1024 * 1024,
  expandedBytes: 75 * 1024 * 1024,
  files: 1_000,
  fileBytes: 20 * 1024 * 1024,
  compressionRatio: 100,
  pathBytes: 255,
});

export const RUNTIME_LIMITS = Object.freeze({
  stateBytes: 64 * 1024,
  actionBytes: 512,
  viewBytes: 2 * 1024,
  eventBytes: 512,
  storageBytes: 1024 * 1024,
});

export const ENGINE_API_VERSION = 1;
export const PACKAGE_SCHEMA_VERSION = 1;

export const SAFE_CAPABILITIES = Object.freeze(['audio', 'storage']);
