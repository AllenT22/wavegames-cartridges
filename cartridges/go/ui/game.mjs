import { WaveGames } from './wavegames-sdk.mjs';

const BOARD_SIZE = 19;
const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
const BLACK = 'b';
const WHITE = 'w';
const EMPTY = '.';

const board = document.querySelector('#board');
const canvas = document.querySelector('#board-canvas');
const intersections = document.querySelector('#intersections');
const seat = document.querySelector('#seat');
const turn = document.querySelector('#turn');
const message = document.querySelector('#message');
const blackPlayer = document.querySelector('#black-player');
const whitePlayer = document.querySelector('#white-player');
const blackName = document.querySelector('#black-name');
const whiteName = document.querySelector('#white-name');
const blackScore = document.querySelector('#black-score');
const whiteScore = document.querySelector('#white-score');
const passButton = document.querySelector('#pass');
const resignButton = document.querySelector('#resign');
const rematchButton = document.querySelector('#rematch');
const buttons = [];

let game;
let latestView;
let submitting = false;
let notice = '';

for (let cell = 0; cell < CELL_COUNT; cell += 1) {
  const x = cell % BOARD_SIZE;
  const y = Math.floor(cell / BOARD_SIZE);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'intersection';
  button.dataset.cell = String(cell);
  button.setAttribute('role', 'gridcell');
  button.style.left = `${5.6 + (x / (BOARD_SIZE - 1)) * 88.8}%`;
  button.style.top = `${5.6 + (y / (BOARD_SIZE - 1)) * 88.8}%`;
  intersections.append(button);
  buttons.push(button);
}

game = await WaveGames.connect({ api: 1 });
const roster = game.context.roster ?? [];
const mode = game.context.mode === 'wave' ? 'Wave match' : 'Local game';
seat.textContent = `Seat ${game.context.seat} · ${mode}`;
blackName.textContent = playerName(roster[0], 'Player 1');
whiteName.textContent = playerName(roster[1], 'Player 2');
game.onView(render);
game.onEvent?.((event) => {
  if (event.type === 'stonesCaptured') notice = `${event.count} ${event.count === 1 ? 'stone' : 'stones'} captured.`;
  if (event.type === 'passed') notice = event.playerId === game.context.playerId ? 'You passed.' : 'Your opponent passed.';
  if (event.type === 'rematchStarted') notice = 'A fresh board is ready. Black plays first.';
});
game.onStatus((status) => {
  if (status === 'recovering') notice = 'Reconnecting to the match…';
  if (status === 'ended') notice = 'The nearby match has ended.';
  if (latestView) render(latestView);
});
if (game.view) render(game.view);

intersections.addEventListener('click', (event) => {
  const target = event.target.closest('button[data-cell]');
  if (!target || !latestView || submitting || !latestView.canPlay) return;
  const cell = Number(target.dataset.cell);
  if (latestView.board[cell] !== EMPTY) return;
  submit({ type: 'place', x: cell % BOARD_SIZE, y: Math.floor(cell / BOARD_SIZE) });
});

passButton.addEventListener('click', () => submit({ type: 'pass' }));
resignButton.addEventListener('click', () => submit({ type: 'resign' }));
rematchButton.addEventListener('click', () => submit({ type: 'rematch' }));

new ResizeObserver(() => drawBoard()).observe(board);

async function submit(action) {
  if (submitting) return;
  submitting = true;
  notice = '';
  render(latestView);
  try {
    const result = await game.sendAction(action);
    if (!result.accepted) notice = result.reason;
  } catch (error) {
    notice = error instanceof Error ? error.message : String(error);
  } finally {
    submitting = false;
    if (latestView) render(latestView);
  }
}

function render(view) {
  if (typeof view.board !== 'string' || view.board.length !== CELL_COUNT) {
    notice = 'The host returned an invalid Go board.';
    message.textContent = notice;
    return;
  }
  latestView = view;
  drawBoard();
  updateIntersections(view);

  const active = view.status === 'active';
  blackPlayer.classList.toggle('active', active && view.turnColor === BLACK);
  whitePlayer.classList.toggle('active', active && view.turnColor === WHITE);
  blackName.textContent = `${playerName(roster[0], 'Player 1')}${view.viewerColor === BLACK ? ' · You' : ''}`;
  whiteName.textContent = `${playerName(roster[1], 'Player 2')}${view.viewerColor === WHITE ? ' · You' : ''}`;

  if (view.status === 'scored') {
    blackScore.textContent = `${formatHalfPoints(view.blackScoreHalfPoints)} points`;
    whiteScore.textContent = `${formatHalfPoints(view.whiteScoreHalfPoints)} points`;
  } else {
    blackScore.textContent = captureLabel(view.captures[0]);
    whiteScore.textContent = captureLabel(view.captures[1]);
  }

  turn.textContent = turnLabel(view);
  message.textContent = notice || statusMessage(view);
  passButton.hidden = !active;
  resignButton.hidden = !active;
  passButton.disabled = submitting || !view.canPass;
  resignButton.disabled = submitting || !view.canResign;
  rematchButton.hidden = active;
  rematchButton.disabled = submitting || !view.canRematch;
  const viewerIndex = view.viewerColor === BLACK ? 0 : 1;
  rematchButton.textContent = view.rematchVotes[viewerIndex]
    ? 'Waiting for opponent…'
    : 'Request rematch';
}

function updateIntersections(view) {
  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    const button = buttons[cell];
    const value = view.board[cell];
    const playable = view.canPlay && value === EMPTY && !submitting;
    button.disabled = !playable;
    button.setAttribute('aria-label', intersectionLabel(cell, value, playable, cell === view.lastMove));
  }
}

function drawBoard() {
  if (!latestView) return;
  const bounds = board.getBoundingClientRect();
  const size = Math.max(1, Math.min(bounds.width, bounds.height));
  const scale = Math.min(window.devicePixelRatio || 1, 3);
  const pixels = Math.round(size * scale);
  if (canvas.width !== pixels || canvas.height !== pixels) {
    canvas.width = pixels;
    canvas.height = pixels;
  }
  const context = canvas.getContext('2d');
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, size, size);

  const wood = context.createLinearGradient(0, 0, size, size);
  wood.addColorStop(0, '#f3cb78');
  wood.addColorStop(0.52, '#dfa958');
  wood.addColorStop(1, '#c8893b');
  context.fillStyle = wood;
  context.fillRect(0, 0, size, size);
  drawWoodGrain(context, size);

  const inset = size * 0.056;
  const step = (size - inset * 2) / (BOARD_SIZE - 1);
  context.strokeStyle = 'rgba(76, 44, 20, 0.78)';
  context.lineWidth = Math.max(0.7, size * 0.0017);
  context.beginPath();
  for (let line = 0; line < BOARD_SIZE; line += 1) {
    const offset = Math.round((inset + line * step) * scale) / scale;
    context.moveTo(inset, offset);
    context.lineTo(size - inset, offset);
    context.moveTo(offset, inset);
    context.lineTo(offset, size - inset);
  }
  context.stroke();

  context.fillStyle = 'rgba(65, 37, 17, 0.88)';
  for (const row of [3, 9, 15]) {
    for (const column of [3, 9, 15]) {
      context.beginPath();
      context.arc(inset + column * step, inset + row * step, Math.max(1.6, step * 0.1), 0, Math.PI * 2);
      context.fill();
    }
  }

  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    const value = latestView.board[cell];
    if (value === EMPTY) continue;
    const x = cell % BOARD_SIZE;
    const y = Math.floor(cell / BOARD_SIZE);
    drawStone(context, inset + x * step, inset + y * step, step * 0.46, value, cell === latestView.lastMove);
  }
}

function drawWoodGrain(context, size) {
  context.save();
  context.globalAlpha = 0.1;
  context.strokeStyle = '#7b431d';
  context.lineWidth = Math.max(0.5, size * 0.0013);
  for (let index = 0; index < 8; index += 1) {
    const y = size * (0.08 + index * 0.12);
    context.beginPath();
    context.moveTo(0, y);
    context.bezierCurveTo(size * 0.3, y + 4, size * 0.64, y - 5, size, y + 2);
    context.stroke();
  }
  context.restore();
}

function drawStone(context, x, y, radius, color, latest) {
  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.34)';
  context.shadowBlur = radius * 0.34;
  context.shadowOffsetX = radius * 0.11;
  context.shadowOffsetY = radius * 0.18;
  const gradient = context.createRadialGradient(
    x - radius * 0.38,
    y - radius * 0.42,
    radius * 0.08,
    x,
    y,
    radius,
  );
  if (color === BLACK) {
    gradient.addColorStop(0, '#656a70');
    gradient.addColorStop(0.48, '#222529');
    gradient.addColorStop(1, '#050607');
  } else {
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.58, '#eeeae3');
    gradient.addColorStop(1, '#bcb6ad');
  }
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.shadowColor = 'transparent';
  context.strokeStyle = color === BLACK ? 'rgba(0,0,0,.8)' : 'rgba(93,84,73,.66)';
  context.lineWidth = Math.max(0.7, radius * 0.06);
  context.stroke();
  if (latest) {
    context.strokeStyle = color === BLACK ? 'rgba(255,255,255,.92)' : 'rgba(0,0,0,.72)';
    context.lineWidth = Math.max(1.1, radius * 0.13);
    context.beginPath();
    context.arc(x, y, radius * 0.22, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

function turnLabel(view) {
  if (view.status === 'scored') return view.winner === view.viewer ? 'You win' : 'Opponent wins';
  if (view.status === 'resigned') return view.winner === view.viewer ? 'Opponent resigned' : 'You resigned';
  return view.turn === view.viewer ? 'Your turn' : "Opponent's turn";
}

function statusMessage(view) {
  if (view.status === 'scored') {
    const margin = Math.abs(view.blackScoreHalfPoints - view.whiteScoreHalfPoints);
    return `${colorName(view.winnerColor)} wins by ${formatHalfPoints(margin)} points.`;
  }
  if (view.status === 'resigned') {
    return view.winner === view.viewer ? 'Your opponent resigned the game.' : 'You resigned the game.';
  }
  if (view.turn !== view.viewer) {
    return view.consecutivePasses === 1 ? 'You passed. Waiting for your opponent.' : 'Waiting for the next move.';
  }
  if (view.consecutivePasses === 1) return 'Your opponent passed. Pass again to score the game, or keep playing.';
  if (view.lastCaptureCount > 0) return `${view.lastCaptureCount} ${view.lastCaptureCount === 1 ? 'stone was' : 'stones were'} captured.`;
  return 'Choose an empty intersection, or pass when you are ready to score.';
}

function intersectionLabel(cell, value, playable, latest) {
  const x = cell % BOARD_SIZE;
  const y = Math.floor(cell / BOARD_SIZE);
  const column = 'ABCDEFGHJKLMNOPQRST'[x];
  const occupant = value === EMPTY ? 'empty' : `${colorName(value)} stone`;
  return `${column}${y + 1}, ${occupant}${latest ? ', last move' : ''}${playable ? ', available' : ''}`;
}

function captureLabel(count) {
  return `${count} ${count === 1 ? 'capture' : 'captures'}`;
}

function formatHalfPoints(halfPoints) {
  return Number.isInteger(halfPoints) ? (halfPoints / 2).toFixed(halfPoints % 2 === 0 ? 0 : 1) : '0';
}

function colorName(color) {
  return color === BLACK ? 'Black' : color === WHITE ? 'White' : 'Unknown';
}

function playerName(player, fallback) {
  return typeof player?.name === 'string' && player.name.length > 0 ? player.name : fallback;
}
