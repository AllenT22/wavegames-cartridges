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

for (let index = 0; index < 64; index += 1) {
  const row = Math.floor(index / 8);
  const column = index % 8;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `square ${(row + column) % 2 === 0 ? 'light' : 'dark'}`;
  button.dataset.cell = String(index);
  button.setAttribute('role', 'gridcell');
  button.setAttribute('aria-label', `Row ${row + 1}, column ${column + 1}`);
  const piece = document.createElement('span');
  piece.className = 'piece';
  const crown = document.createElement('span');
  crown.className = 'crown';
  crown.textContent = '♛';
  piece.append(crown);
  button.append(piece);
  board.append(button);
  squares.push({ button, piece });
}

const game = await WaveGames.connect({ api: 1 });
seat.textContent = `Seat ${game.context.seat} · Player ${game.context.seat}`;
game.onView(render);
game.onEvent?.((event) => {
  if (event.type === 'promoted') notice = 'King crowned.';
  if (event.type === 'rematchStarted') notice = 'A new game begins.';
});
if (game.view) render(game.view);

board.addEventListener('click', async (event) => {
  const target = event.target.closest('button[data-cell]');
  if (!target || !latestView || submitting || latestView.finished) return;
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
  latestView = view;
  const legalFrom = new Set(view.legalMoves.map((move) => move.from));
  if (view.forcedPiece !== NO_FORCED_PIECE) selected = view.forcedPiece;
  if (selected !== null && !legalFrom.has(selected)) selected = null;
  const targetMoves = view.legalMoves.filter((move) => move.from === selected);
  const legalTargets = new Map(targetMoves.map((move) => [move.to, move]));
  board.classList.toggle('player-two', view.mySide === 2);

  for (let index = 0; index < squares.length; index += 1) {
    const value = view.cells[index];
    const { button, piece } = squares[index];
    const isKing = value === 2 || value === 4;
    piece.className = `piece ${value === 1 || value === 2 ? 'red' : value === 3 || value === 4 ? 'black' : ''} ${isKing ? 'king' : ''}`;
    button.classList.toggle('selectable', legalFrom.has(index));
    button.classList.toggle('selected', selected === index);
    button.classList.toggle('destination', legalTargets.has(index));
    button.classList.toggle('capture', legalTargets.get(index)?.capture === true);
    button.disabled = submitting || (!legalFrom.has(index) && !legalTargets.has(index));
    const pieceName = value === 0 ? 'empty' : `${value <= 2 ? 'Player 1' : 'Player 2'} ${isKing ? 'king' : 'piece'}`;
    const actionName = legalTargets.has(index) ? ', legal destination' : legalFrom.has(index) ? ', selectable' : '';
    button.setAttribute('aria-label', `Row ${Math.floor(index / 8) + 1}, column ${(index % 8) + 1}, ${pieceName}${actionName}`);
  }

  if (view.winner) {
    const won = view.winner === view.viewer;
    turn.textContent = won ? 'You win!' : 'Opponent wins';
    message.textContent = notice || (won ? 'Your opponent has no move left.' : 'No legal moves remain.');
  } else if (view.draw) {
    turn.textContent = 'Draw';
    message.textContent = notice || 'Eighty moves passed without a capture or a new king.';
  } else if (view.turn === view.viewer) {
    turn.textContent = view.forcedPiece === NO_FORCED_PIECE ? 'Your turn' : 'Keep jumping';
    message.textContent = notice || turnPrompt(view, selected);
  } else {
    turn.textContent = "Opponent's turn";
    message.textContent = notice || 'Waiting for the next move.';
  }

  surrender.hidden = view.finished;
  surrender.disabled = submitting || !view.canSurrender;
  rematch.hidden = !view.finished;
  rematch.disabled = submitting || !view.canRequestRematch;
  rematch.textContent = view.rematchVotes[view.mySide - 1] ? 'Waiting for opponent…' : 'Request rematch';
}

function turnPrompt(view, selectedCell) {
  if (selectedCell !== null) return view.captureRequired ? 'Choose the highlighted landing square to capture.' : 'Choose a highlighted destination.';
  if (view.captureRequired) return 'A capture is available and must be taken.';
  return 'Choose one of your glowing pieces.';
}
