import { PACKAGE_LIMITS } from './constants.mjs';

export function normalizePackagePath(input, { directory = false } = {}) {
  if (typeof input !== 'string' || input.length === 0) throw new Error('Package path must be a non-empty string');
  if (input.includes('\0') || input.includes('\\')) throw new Error(`Package path contains a forbidden character: ${input}`);
  if (input.startsWith('/') || /^[A-Za-z]:/.test(input)) throw new Error(`Package path must be relative: ${input}`);
  let path = input;
  if (directory && path.endsWith('/')) path = path.slice(0, -1);
  if (!directory && path.endsWith('/')) throw new Error(`File path cannot end with a slash: ${input}`);
  if (Buffer.byteLength(path) > PACKAGE_LIMITS.pathBytes) throw new Error(`Package path is too long: ${input}`);
  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`Package path contains an unsafe segment: ${input}`);
  }
  for (const segment of segments) {
    if (/[\u0000-\u001f\u007f]/.test(segment)) throw new Error(`Package path contains an unsafe segment: ${input}`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)) {
      throw new Error(`Package path is not portable ASCII: ${input}`);
    }
  }
  return directory ? `${path}/` : path;
}

export function comparePackagePaths(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

export function assertNoPathCollisions(paths) {
  const seen = new Map();
  for (const path of paths) {
    const directory = path.endsWith('/');
    const normalized = normalizePackagePath(path, { directory });
    const bare = directory ? normalized.slice(0, -1) : normalized;
    const folded = bare.toLowerCase();
    if (seen.has(folded)) throw new Error(`Package paths collide: ${seen.get(folded).path} and ${path}`);
    for (const [existing, details] of seen) {
      if (folded.startsWith(`${existing}/`) && !details.directory) {
        throw new Error(`Package path collides with a parent file: ${details.path} and ${path}`);
      }
      if (existing.startsWith(`${folded}/`) && !directory) {
        throw new Error(`Package path collides with a parent file: ${path} and ${details.path}`);
      }
    }
    seen.set(folded, { path, directory });
  }
}
