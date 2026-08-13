import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { extractWavegame, validateSourceDirectory, validateWavegame } from './package.mjs';

export async function runCartridgeTests(inputPath) {
  const loaded = await loadTrustedSource(inputPath);
  try {
    return await runInTestWorker({ root: loaded.root, summary: loaded.summary });
  } finally {
    await loaded.cleanup();
  }
}

export async function loadTrustedSource(inputPath) {
  const absolute = path.resolve(inputPath);
  if (absolute.toLowerCase().endsWith('.wavegame')) {
    throw new Error('wavegame test executes developer rules; archives are validation-only and are never executed');
  }
  const summary = await validateSourceDirectory(absolute);
  return { root: absolute, summary, cleanup: async () => {} };
}

/// Loads validated content for the browser simulator. Unlike `test`, the
/// simulator does not import cartridge rules into the CLI process: rules run
/// in its browser Worker, so a validated archive may be extracted here.
export async function loadCartridgeForSimulator(inputPath) {
  const absolute = path.resolve(inputPath);
  if (!absolute.toLowerCase().endsWith('.wavegame')) {
    return loadTrustedSource(absolute);
  }
  const archive = await readFile(absolute);
  const summary = validateWavegame(archive);
  const temporary = await mkdtemp(path.join(tmpdir(), 'wavegame-simulator-'));
  await extractWavegame(archive, temporary);
  return {
    root: temporary,
    summary,
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

function runInTestWorker(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./test-worker.mjs', import.meta.url), { workerData });
    let response;
    let workerError;
    const timeout = setTimeout(() => {
      workerError = new Error('Cartridge tests exceeded the 60 second limit');
      void worker.terminate();
    }, 60_000);
    worker.once('message', (message) => { response = message; });
    worker.once('error', (error) => { workerError = error; });
    worker.once('exit', (code) => {
      clearTimeout(timeout);
      if (workerError) return reject(workerError);
      if (code !== 0) return reject(new Error(`Cartridge test worker exited with code ${code}`));
      if (!response) return reject(new Error('Cartridge test worker exited without a report'));
      if (response.ok) return resolve(response.report);
      const error = new Error(response.error?.message ?? 'Cartridge tests failed');
      if (response.error?.stack) error.stack = response.error.stack;
      reject(error);
    });
  });
}
