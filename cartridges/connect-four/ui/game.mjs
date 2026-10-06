import { WaveGames } from './wavegames-sdk.mjs';

const board = document.querySelector('#board');
const columns = document.querySelector('#columns');
const message = document.querySelector('#message');
const turn = document.querySelector('#turn');
const seat = document.querySelector('#seat');
const surrender = document.querySelector('#surrender');
const rematch = document.querySelector('#rematch');
const myDisc = document.querySelector('#my-disc');
const cells = [];
const drops = [];
let game;
let latestView;
let submitting = false;
let notice = '';
let unavailable = false;
let connectionNotice = '';

// One full-size control per column avoids 42 tiny, repeated keyboard targets.
for (let column = 0; column < 7; column += 1) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'drop';
  button.dataset.column = String(column);
  button.textContent = `↓ ${column + 1}`;
  button.setAttribute('aria-label', `Drop in column ${column + 1}`);
  button.disabled = true;
  columns.append(button);
  drops.push(button);
}
for (let index = 0; index < 42; index += 1) {
  const slot = document.createElement('div');
  slot.className = 'slot';
  slot.setAttribute('role', 'img');
  const disc = document.createElement('span');
  disc.className = 'disc';
  slot.append(disc);
  board.append(slot);
  cells.push({ slot, disc });
}

columns.addEventListener('click', (event) => {
  const target = event.target.closest('button[data-column]');
  if (!target || !latestView) return;
  const column = Number(target.dataset.column);
  if (latestView.canDrop[column]) submit({ type: 'drop', column });
});
surrender.addEventListener('click', () => submit({ type: 'surrender' }));
rematch.addEventListener('click', () => submit({ type: 'rematch' }));

try {
  game = await WaveGames.connect({ api: 1 });
  game.onView((view) => {
    if (latestView && view.revision !== latestView.revision) notice = '';
    render(view);
  });
  game.onStatus((status) => {
    unavailable = ['recovering', 'connecting', 'disconnected', 'ended', 'closed'].includes(status);
    connectionNotice = ['ended', 'closed'].includes(status) ? 'The match has ended. Return to the host to start a new game.'
      : unavailable ? 'Reconnecting to the match…' : '';
    if (latestView) render(latestView);
  });
  if (game.view) render(game.view);
} catch (error) {
  seat.textContent = 'Host unavailable';
  turn.textContent = 'Connection failed';
  message.textContent = `${error instanceof Error ? error.message : String(error)}. Reopen the game from the host.`;
}

async function submit(action) {
  if (!game || !latestView || submitting || unavailable) return;
  submitting = true;
  notice = '';
  render(latestView);
  try {
    const result = await game.sendAction(action);
    if (!result.accepted) notice = result.reason || 'The action was rejected. Try again.';
  } catch (error) {
    notice = error instanceof Error ? error.message : String(error);
  } finally {
    submitting = false;
    if (latestView) render(latestView);
  }
}

function render(view) {
  latestView = view;
  seat.textContent = `Seat ${game.context.seat} · Your disc: ${view.myDisc === 1 ? 'Red 1' : 'Yellow 2'}`;
  myDisc.textContent = `You: ${view.myDisc === 1 ? 'Red 1' : 'Yellow 2'} · Opponent: ${view.myDisc === 1 ? 'Yellow 2' : 'Red 1'}`;
  const winning = new Set(view.winningCells);
  for (let index = 0; index < cells.length; index += 1) {
    const value = view.cells[index];
    cells[index].disc.className = `disc ${value === 1 ? 'red' : value === 2 ? 'yellow' : ''}`;
    cells[index].disc.textContent = value || '';
    cells[index].slot.classList.toggle('winner', winning.has(index));
    cells[index].slot.setAttribute('aria-label', `Row ${Math.floor(index / 7) + 1}, column ${index % 7 + 1}: ${value === 1 ? 'Red 1' : value === 2 ? 'Yellow 2' : 'empty'}${winning.has(index) ? ', winning disc' : ''}`);
  }
  for (let column = 0; column < drops.length; column += 1) {
    const full = view.cells[column] !== 0;
    drops[column].disabled = submitting || unavailable || !view.canDrop[column];
    drops[column].setAttribute('aria-label', `Drop in column ${column + 1}${full ? ', full' : ''}`);
  }
  let description;
  if (view.winner) {
    const won = view.winner === view.viewer;
    turn.textContent = won ? 'You win' : 'Opponent wins';
    description = view.winningCells.length ? (won ? 'You connected four.' : 'Your opponent connected four.')
      : won ? 'Your opponent surrendered.' : 'You surrendered.';
  } else if (view.draw) {
    turn.textContent = 'Draw';
    description = 'The board is full.';
  } else if (view.turn === view.viewer) {
    turn.textContent = 'Your turn';
    description = 'Choose a column above the board.';
  } else {
    turn.textContent = "Opponent’s turn";
    description = 'Waiting for the next move.';
  }
  message.textContent = connectionNotice || notice || (submitting ? 'Sending move…' : description);
  if (unavailable) turn.textContent = 'Host unavailable';
  const finished = view.winner !== null || view.draw;
  surrender.hidden = finished;
  surrender.disabled = submitting || unavailable;
  rematch.hidden = !finished;
  const voted = view.rematchVotes[view.myDisc - 1];
  rematch.disabled = submitting || unavailable || voted;
  rematch.textContent = voted ? 'Waiting for opponent…' : 'Request rematch';
}
