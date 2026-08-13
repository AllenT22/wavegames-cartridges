import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceManifestText } from './package.mjs';
import { validateManifest } from './manifest.mjs';

export async function createCartridge(directory, options = {}) {
  const root = path.resolve(directory);
  await assertEmptyOrMissing(root);
  const title = options.title ?? titleFromDirectory(root);
  const id = options.id ?? `games.example.${slugFromTitle(title)}`;
  const manifest = {
    formatVersion: 1,
    id,
    version: '0.1.0',
    title: { en: title },
    description: { en: 'A new Wave Games cartridge.' },
    icon: 'assets/icon.svg',
    engineApi: 1,
    entrypoints: { rules: 'rules/index.mjs', ui: 'ui/index.html' },
    orientation: 'any',
    capabilities: ['storage'],
    modes: {
      local: { minPlayers: 2, maxPlayers: 8 },
      wave: { minPlayers: 2, maxPlayers: 8, pace: 'turn-based' },
    },
  };
  validateManifest(structuredClone(manifest));
  const sdk = await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'sdk', 'wavegames-sdk.mjs'));
  const files = new Map([
    ['wavegame.json', sourceManifestText(manifest)],
    ['rules/index.mjs', scaffoldRules],
    ['ui/index.html', scaffoldHtml(title)],
    ['ui/game.mjs', scaffoldUi],
    ['ui/wavegames-sdk.mjs', sdk],
    ['ui/styles.css', scaffoldCss],
    ['assets/icon.svg', scaffoldIcon],
    ['tests/scenarios.mjs', scaffoldScenario],
  ]);
  for (const [relative, contents] of files) {
    const destination = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents, { flag: 'wx' });
  }
  return { root, manifest, files: [...files.keys()] };
}

async function assertEmptyOrMissing(root) {
  try {
    const entries = await readdir(root);
    if (entries.length !== 0) throw new Error(`Destination is not empty: ${root}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function titleFromDirectory(root) {
  return path.basename(root)
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ') || 'My Wave Game';
}

function slugFromTitle(title) {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'my-game';
}

const scaffoldRules = `// Rules run in the authority context. Do not access the DOM here.
export function create({ players }) {
  return { turn: players[0].id, move: 0, lastPlayer: null };
}

export function reduce({ state, playerId, action }) {
  if (action?.type !== 'advance') return { accepted: false, reason: 'Unknown action' };
  if (playerId !== state.turn) return { accepted: false, reason: 'Wait for your turn' };
  const seat = Number(playerId.slice('player-'.length));
  const nextSeat = seat === action.playerCount ? 1 : seat + 1;
  return {
    accepted: true,
    state: { turn: \`player-\${nextSeat}\`, move: state.move + 1, lastPlayer: playerId },
    events: [{ type: 'advanced', playerId }],
  };
}

export function view({ state, viewer, players, revision }) {
  return {
    ...state,
    viewer,
    revision,
    playerCount: players.length,
    canAdvance: state.turn === viewer,
  };
}
`;

function scaffoldHtml(title) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="styles.css">
  </head>
  <body>
    <main>
      <p id="seat">Connecting…</p>
      <h1>${escapeHtml(title)}</h1>
      <p id="status">Waiting for the host.</p>
      <button id="advance" type="button" disabled>Take turn</button>
    </main>
    <script type="module" src="game.mjs"></script>
  </body>
</html>
`;
}

const scaffoldUi = `// Rendering receives only the current player's filtered view.
import { WaveGames } from './wavegames-sdk.mjs';

const seat = document.querySelector('#seat');
const status = document.querySelector('#status');
const advance = document.querySelector('#advance');
const game = await WaveGames.connect({ api: 1 });
seat.textContent = \`Seat \${game.context.seat} · \${game.context.playerId}\`;

game.onView((view) => {
  status.textContent = \`Move \${view.move} · \${view.turn}'s turn\`;
  advance.disabled = !view.canAdvance;
  advance.dataset.playerCount = String(view.playerCount);
});

advance.addEventListener('click', async () => {
  advance.disabled = true;
  const result = await game.sendAction({
    type: 'advance',
    playerCount: Number(advance.dataset.playerCount),
  });
  if (!result.accepted) status.textContent = result.reason;
});
`;

const scaffoldCss = `:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #12241f; color: #f4f7f5; }
main { width: min(28rem, calc(100% - 2rem)); padding: 2rem; box-sizing: border-box; border: 1px solid #ffffff30; border-radius: 1.25rem; background: #18372e; text-align: center; }
button { border: 0; border-radius: 999px; padding: .8rem 1.2rem; font: inherit; font-weight: 700; background: #74d3ae; color: #09271e; }
button:disabled { opacity: .45; }
`;

const scaffoldIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#17372d"/>
  <path d="M32 74c14-34 22 20 34-11s17 12 30-15" fill="none" stroke="#74d3ae" stroke-width="12" stroke-linecap="round"/>
</svg>
`;

const scaffoldScenario = `export const scenarios = [{
  name: 'turn advances',
  players: 3,
  async run({ host, assert }) {
    const result = await host.dispatchAction(1, { type: 'advance', playerCount: 3 });
    assert.equal(result.accepted, true);
    assert.equal((await host.viewForSeat(2)).turn, 'player-2');
  },
}];
`;

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
