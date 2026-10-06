import { WaveGames } from './wavegames-sdk.mjs';

const NO_FORCED_PIECE = 255;
const board = document.querySelector('#board');
const message = document.querySelector('#message');
const turn = document.querySelector('#turn');
const seat = document.querySelector('#seat');
const surrender = document.querySelector('#surrender');
const rematch = document.querySelector('#rematch');
const squares = [];
let latestView;
let selected = null;
let submitting = false;
let notice = '';
let game;
let connected = false;

for (let index = 0; index < 64; index += 1) {
  const row = Math.floor(index / 8);
  const column = index % 8;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `square ${(row + column) % 2 === 0 ? 'light' : 'dark'}`;
  button.dataset.cell = String(index);
  button.disabled = true;
  button.setAttribute('aria-label', `Row ${row + 1}, column ${column + 1}`);
  const piece = document.createElement('span');
  piece.className = 'piece';
  const crown = document.createElement('span');
  crown.className = 'crown';
  crown.textContent = 'K';
  const sideMark = document.createElement('span');
  sideMark.className = 'side-mark';
  piece.append(crown, sideMark);
  button.append(piece);
  board.append(button);
  squares.push({ button, piece, sideMark });
}

try {
  game = await WaveGames.connect({ api: 1 });
  connected = true;
  seat.textContent = `Seat ${game.context.seat} · Player ${game.context.seat}`;
  game.onView(render);
  game.onStatus((status) => {
    connected = !['connecting', 'disconnected', 'ended', 'closed', 'error'].includes(status);
    if (!connected) notice = 'Connection interrupted. Rejoin this game to continue.';
    else notice = '';
    if (latestView) render(latestView);
  });
  game.on?.('error', (error) => {
    notice = typeof error === 'string' ? error : 'The host reported an error.';
    if (latestView) render(latestView);
  });
  if (game.view) render(game.view);
} catch (error) {
  seat.textContent = 'Connection unavailable';
  turn.textContent = 'Unable to connect';
  message.textContent = `${error instanceof Error ? error.message : String(error)}. Rejoin the game to try again.`;
}

board.addEventListener('click', async (event) => {
  const target = event.target.closest('button[data-cell]');
  if (!target || !latestView || !connected || submitting || latestView.finished) return;
  const cell = Number(target.dataset.cell);
  const moves = latestView.legalMoves;
  const destinations = selected === null ? [] : moves.filter((move) => move.from === selected);
  const chosen = destinations.find((move) => move.to === cell);
  if (chosen) {
    await submit({ type: 'move', from: chosen.from, to: chosen.to });
    return;
  }
  if (moves.some((move) => move.from === cell)) {
    selected = selected === cell && latestView.forcedPiece === NO_FORCED_PIECE ? null : cell;
    notice = '';
    render(latestView);
    return;
  }
  if (latestView.forcedPiece === NO_FORCED_PIECE) {
    selected = null;
    render(latestView);
  }
});

surrender.addEventListener('click', () => submit({ type: 'surrender' }));
rematch.addEventListener('click', () => submit({ type: 'rematch' }));

board.addEventListener('keydown', (event) => {
  const target = event.target.closest('button[data-cell]');
  if (!target || !latestView) return;
  if (event.key === 'Escape' && latestView.forcedPiece === NO_FORCED_PIECE) {
    selected = null;
    render(latestView);
    return;
  }
  const steps = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
  if (!steps[event.key]) return;
  event.preventDefault();
  const index = Number(target.dataset.cell);
  const row = Math.floor(index / 8);
  const column = index % 8;
  const flip = latestView.mySide === 2 ? -1 : 1;
  const [dr, dc] = steps[event.key].map((step) => step * flip);
  const candidates = squares.filter(({ button }) => !button.disabled).map(({ button }) => {
    const cell = Number(button.dataset.cell);
    const rowDelta = Math.floor(cell / 8) - row;
    const columnDelta = cell % 8 - column;
    return { button, forward: rowDelta * dr + columnDelta * dc, across: Math.abs(rowDelta * dc - columnDelta * dr) };
  }).filter(({ forward }) => forward > 0).sort((a, b) => a.forward + a.across * 2 - b.forward - b.across * 2);
  candidates[0]?.button.focus();
});

async function submit(action) {
  if (submitting || !connected || !latestView) return;
  if (action.type === 'surrender' && !latestView.canSurrender) return;
  if (action.type === 'rematch' && !latestView.canRequestRematch) return;
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
  if (latestView && latestView.revision !== view.revision && connected) notice = '';
  latestView = view;
  const legalFrom = new Set(view.legalMoves.map((move) => move.from));
  if (view.forcedPiece !== NO_FORCED_PIECE) selected = view.forcedPiece;
  if (selected !== null && !legalFrom.has(selected)) selected = null;
  const targetMoves = view.legalMoves.filter((move) => move.from === selected);
  const legalTargets = new Map(targetMoves.map((move) => [move.to, move]));
  board.classList.toggle('player-two', view.mySide === 2);

  for (let index = 0; index < squares.length; index += 1) {
    const value = view.cells[index];
    const { button, piece, sideMark } = squares[index];
    const isKing = value === 2 || value === 4;
    piece.className = `piece ${value === 1 || value === 2 ? 'red' : value === 3 || value === 4 ? 'black' : ''} ${isKing ? 'king' : ''}`;
    sideMark.textContent = value === 0 ? '' : value <= 2 ? '1' : '2';
    button.classList.toggle('selectable', legalFrom.has(index));
    button.classList.toggle('selected', selected === index);
    button.classList.toggle('destination', legalTargets.has(index));
    button.classList.toggle('capture', legalTargets.get(index)?.capture === true);
    button.disabled = !connected || submitting || (!legalFrom.has(index) && !legalTargets.has(index));
    const pieceName = value === 0 ? 'empty' : `${value <= 2 ? 'Player 1' : 'Player 2'} ${isKing ? 'king' : 'piece'}`;
    const actionName = legalTargets.has(index) ? `, ${legalTargets.get(index).capture ? 'capture' : 'move'} destination` : legalFrom.has(index) ? ', selectable' : '';
    button.setAttribute('aria-label', `Row ${Math.floor(index / 8) + 1}, column ${(index % 8) + 1}, ${pieceName}${actionName}`);
    button.setAttribute('aria-pressed', String(selected === index));
  }

  if (view.winner) {
    const won = view.winner === view.viewer;
    turn.textContent = won ? 'You win!' : 'Opponent wins';
    message.textContent = notice || (view.finishReason === 'surrender'
      ? won ? 'Your opponent surrendered.' : 'You surrendered.'
      : view.finishReason === 'blocked' ? won ? 'Your opponent has no legal moves.' : 'You have no legal moves.'
        : 'Game finished. Request a rematch to play again.');
  } else if (view.draw) {
    turn.textContent = 'Draw';
    message.textContent = notice || 'Forty moves each without a capture or an uncrowned piece advancing.';
  } else if (view.turn === view.viewer) {
    turn.textContent = view.forcedPiece === NO_FORCED_PIECE ? 'Your turn' : 'Keep jumping';
    message.textContent = notice || turnPrompt(view, selected);
  } else {
    turn.textContent = "Opponent's turn";
    message.textContent = notice || 'Waiting for the next move.';
  }

  surrender.hidden = view.finished;
  surrender.disabled = !connected || submitting || !view.canSurrender;
  rematch.hidden = !view.finished;
  rematch.disabled = !connected || submitting || !view.canRequestRematch;
  rematch.textContent = view.rematchVotes[view.mySide - 1] ? 'Waiting for opponent…' : 'Request rematch';
  if (!connected) turn.textContent = 'Connection interrupted';
}

function turnPrompt(view, selectedCell) {
  if (selectedCell !== null) return view.captureRequired ? 'Choose the highlighted landing square to capture.' : 'Choose a highlighted destination.';
  if (view.captureRequired) return 'A capture is available and must be taken.';
  return 'Choose an outlined piece. Tab or arrow keys navigate; Enter selects.';
}
