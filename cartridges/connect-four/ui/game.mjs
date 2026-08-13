import { WaveGames } from './wavegames-sdk.mjs';

const board = document.querySelector('#board');
const message = document.querySelector('#message');
const turn = document.querySelector('#turn');
const seat = document.querySelector('#seat');
const surrender = document.querySelector('#surrender');
const rematch = document.querySelector('#rematch');
const cells = [];
let latestView;
let submitting = false;

for (let index = 0; index < 42; index += 1) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'slot';
  button.dataset.column = String(index % 7);
  button.setAttribute('aria-label', `Row ${Math.floor(index / 7) + 1}, column ${(index % 7) + 1}`);
  const disc = document.createElement('span');
  disc.className = 'disc';
  button.append(disc);
  board.append(button);
  cells.push({ button, disc });
}

const game = await WaveGames.connect({ api: 1 });
seat.textContent = `Seat ${game.context.seat} · You are Player ${game.context.seat}`;
game.onView(render);
if (game.view) render(game.view);

board.addEventListener('click', async (event) => {
  const target = event.target.closest('button[data-column]');
  if (!target || submitting || !latestView) return;
  const column = Number(target.dataset.column);
  if (!latestView.canDrop[column]) return;
  submitting = true;
  render(latestView);
  try {
    const result = await game.sendAction({ type: 'drop', column });
    if (!result.accepted) message.textContent = result.reason;
  } finally {
    submitting = false;
    if (latestView) render(latestView);
  }
});

surrender.addEventListener('click', () => submit({ type: 'surrender' }));
rematch.addEventListener('click', () => submit({ type: 'rematch' }));

async function submit(action) {
  if (submitting) return;
  submitting = true;
  if (latestView) render(latestView);
  try {
    const result = await game.sendAction(action);
    if (!result.accepted) message.textContent = result.reason;
  } finally {
    submitting = false;
    if (latestView) render(latestView);
  }
}

function render(view) {
  latestView = view;
  const winning = new Set(view.winningCells);
  for (let index = 0; index < cells.length; index += 1) {
    const value = view.cells[index];
    cells[index].disc.className = `disc ${value === 1 ? 'red' : value === 2 ? 'yellow' : ''}`;
    cells[index].button.classList.toggle('winner', winning.has(index));
    cells[index].button.disabled = submitting || !view.canDrop[index % 7];
  }
  if (view.winner) {
    const won = view.winner === view.viewer;
    turn.textContent = won ? 'You win!' : 'Opponent wins';
    message.textContent = won ? 'Four in a row — nicely played.' : 'Four in a row for your opponent.';
  } else if (view.draw) {
    turn.textContent = 'Draw';
    message.textContent = 'The board is full.';
  } else if (view.turn === view.viewer) {
    turn.textContent = 'Your turn';
    message.textContent = 'Choose any open column.';
  } else {
    turn.textContent = "Opponent's turn";
    message.textContent = 'Waiting for the next move.';
  }
  const finished = Boolean(view.winner) || view.draw;
  surrender.hidden = finished;
  surrender.disabled = submitting;
  rematch.hidden = !finished;
  rematch.disabled = submitting || view.rematchVotes[view.myDisc - 1];
  rematch.textContent = view.rematchVotes[view.myDisc - 1] ? 'Waiting for opponent…' : 'Request rematch';
}
