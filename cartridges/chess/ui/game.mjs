import { WaveGames } from './wavegames-sdk.mjs';
import { decodeHistory, decodeLegalMoves, decodePiece } from './view-codec.mjs';

const glyphs = Object.freeze({
  white: Object.freeze({ king: '♔', queen: '♕', rook: '♖', bishop: '♗', knight: '♘', pawn: '♙' }),
  black: Object.freeze({ king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' }),
});
const promotionNames = Object.freeze(['queen', 'rook', 'bishop', 'knight']);
const board = document.querySelector('#board');
const boardHint = document.querySelector('#board-hint');
new ResizeObserver(() => {
  boardHint.hidden = board.parentElement.scrollWidth <= board.parentElement.clientWidth;
}).observe(board.parentElement);
const seat = document.querySelector('#seat');
const turn = document.querySelector('#turn');
const message = document.querySelector('#message');
const whitePlayer = document.querySelector('#white-player');
const blackPlayer = document.querySelector('#black-player');
const whiteName = document.querySelector('#white-name');
const blackName = document.querySelector('#black-name');
const whiteState = document.querySelector('#white-state');
const blackState = document.querySelector('#black-state');
const history = document.querySelector('#history');
const moveCount = document.querySelector('#move-count');
const offerDraw = document.querySelector('#offer-draw');
const acceptDraw = document.querySelector('#accept-draw');
const declineDraw = document.querySelector('#decline-draw');
const resign = document.querySelector('#resign');
const rematch = document.querySelector('#rematch');
const promotion = document.querySelector('#promotion');
const promotionChoices = document.querySelector('#promotion-choices');
const cancelPromotion = document.querySelector('#cancel-promotion');
const squares = [];
let game;
let latestView;
let selected = null;
let pendingPromotion = null;
let submitting = false;
let notice = '';
let unavailable = false;
let promotionFocus = null;

for (let index = 0; index < 64; index += 1) {
  const row = Math.floor(index / 8);
  const column = index % 8;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `square ${(row + column) % 2 === 0 ? 'light' : 'dark'}`;
  button.dataset.square = String(index);
  const piece = document.createElement('span');
  piece.className = 'piece';
  button.append(piece);
  board.append(button);
  squares.push({ button, piece });
}

for (const type of promotionNames) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'promotion-choice';
  button.dataset.promotion = type;
  button.setAttribute('aria-label', `Promote to ${type}`);
  promotionChoices.append(button);
}

for (const button of document.querySelectorAll('button')) button.disabled = true;
try {
  game = await WaveGames.connect({ api: 1 });
  unavailable = ['disconnected', 'ended', 'closed'].includes(game.status);
  if (unavailable) notice = 'Connection interrupted. Rejoin the match to continue.';
  seat.textContent = `Seat ${game.context.seat} · ${game.context.mode === 'wave' ? 'Wave match' : 'Local game'}`;
  game.onView(render);
  game.onStatus?.((status) => {
    unavailable = ['disconnected', 'ended', 'closed'].includes(status);
    if (unavailable) {
      notice = 'Connection interrupted. Rejoin the match to continue.';
      hidePromotion();
    } else if (status === 'connected') notice = '';
    if (latestView) render(latestView);
  });
  if (game.view) render(game.view);
} catch (error) {
  seat.textContent = 'Connection unavailable';
  turn.textContent = 'Unable to join';
  message.textContent = error instanceof Error ? error.message : String(error);
}

board.addEventListener('click', (event) => {
  const target = event.target.closest('button[data-square]');
  if (!target || !latestView || submitting || unavailable || pendingPromotion !== null || latestView.status !== 'playing') return;
  const square = Number(target.dataset.square);
  const legalMoves = decodeLegalMoves(latestView.legalMoves);
  const movesFromSelected = selected === null ? [] : legalMoves.filter((move) => move.from === selected && move.to === square);
  if (movesFromSelected.length > 0) {
    if (movesFromSelected.some((move) => move.promotion !== null)) {
      pendingPromotion = { from: selected, to: square };
      showPromotion();
    } else {
      submit({ type: 'move', from: selected, to: square });
    }
    return;
  }
  if (legalMoves.some((move) => move.from === square)) {
    selected = selected === square ? null : square;
    notice = '';
    render(latestView);
    return;
  }
  selected = null;
  render(latestView);
});

promotionChoices.addEventListener('click', (event) => {
  const target = event.target.closest('button[data-promotion]');
  if (!target || pendingPromotion === null) return;
  const action = { type: 'move', ...pendingPromotion, promotion: target.dataset.promotion };
  hidePromotion();
  submit(action);
});
cancelPromotion.addEventListener('click', hidePromotion);
offerDraw.addEventListener('click', () => submit({ type: 'offerDraw' }));
acceptDraw.addEventListener('click', () => submit({ type: 'acceptDraw' }));
declineDraw.addEventListener('click', () => submit({ type: 'declineDraw' }));
resign.addEventListener('click', () => submit({ type: 'resign' }));
rematch.addEventListener('click', () => submit({ type: 'rematch' }));

async function submit(action) {
  if (submitting || unavailable || !game || !latestView) return;
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
  if (latestView && latestView.revision !== view.revision && !unavailable) notice = '';
  latestView = view;
  const legalMoves = decodeLegalMoves(view.legalMoves);
  if (pendingPromotion !== null && !legalMoves.some((move) => move.from === pendingPromotion.from && move.to === pendingPromotion.to && move.promotion !== null)) {
    hidePromotion();
  }
  const legalFrom = new Set(legalMoves.map((move) => move.from));
  if (selected !== null && !legalFrom.has(selected)) selected = null;
  const destinations = new Map(
    legalMoves.filter((move) => move.from === selected).map((move) => [move.to, move]),
  );
  const lastSquares = new Set(view.lastMove === null ? [] : view.lastMove);
  board.classList.toggle('black-view', view.myColor === 'black');

  for (let index = 0; index < squares.length; index += 1) {
    const entry = decodePiece(view.board[index]);
    const { button, piece } = squares[index];
    const isCapture = destinations.has(index) && entry !== null;
    piece.textContent = entry === null ? '' : glyphs[entry.color][entry.type];
    piece.className = `piece ${entry === null ? '' : `${entry.color}-piece`}`;
    button.classList.toggle('selectable', legalFrom.has(index));
    button.classList.toggle('selected', selected === index);
    button.classList.toggle('destination', destinations.has(index));
    button.classList.toggle('capture', isCapture || destinations.get(index)?.isEnPassant === true);
    button.classList.toggle('last', lastSquares.has(index));
    button.disabled = submitting || unavailable || (!legalFrom.has(index) && !destinations.has(index));
    button.setAttribute('aria-pressed', String(selected === index));
    const name = squareName(index);
    const occupant = entry === null ? 'empty' : `${entry.color} ${entry.type}`;
    const action = destinations.has(index) ? ', legal destination' : legalFrom.has(index) ? ', selectable' : '';
    button.setAttribute('aria-label', `${name}, ${occupant}${action}`);
  }

  whiteName.textContent = `White · ${view.players[0].name}${view.myColor === 'white' ? ' · You' : ''}`;
  blackName.textContent = `Black · ${view.players[1].name}${view.myColor === 'black' ? ' · You' : ''}`;
  whitePlayer.classList.toggle('active', view.status === 'playing' && view.turnColor === 'white');
  blackPlayer.classList.toggle('active', view.status === 'playing' && view.turnColor === 'black');
  whitePlayer.classList.toggle('in-check', view.inCheck && view.turnColor === 'white');
  blackPlayer.classList.toggle('in-check', view.inCheck && view.turnColor === 'black');
  whiteState.textContent = playerState(view, 'white');
  blackState.textContent = playerState(view, 'black');
  turn.textContent = turnLabel(view);
  message.textContent = notice || statusMessage(view, selected);
  renderHistory(decodeHistory(view.history), view.historyOffset, view.moveCount);

  const playing = view.status === 'playing';
  offerDraw.hidden = !playing || view.drawOfferBy !== null;
  offerDraw.disabled = submitting || unavailable || !view.canOfferDraw;
  acceptDraw.hidden = !view.canAcceptDraw;
  acceptDraw.disabled = submitting || unavailable || !view.canAcceptDraw;
  declineDraw.hidden = !view.canDeclineDraw;
  declineDraw.disabled = submitting || unavailable || !view.canDeclineDraw;
  resign.hidden = !playing;
  resign.disabled = submitting || unavailable || !view.canResign;
  rematch.hidden = playing;
  rematch.disabled = submitting || unavailable || !view.canRequestRematch;
  const voteIndex = view.myColor === 'white' ? 0 : 1;
  rematch.textContent = view.rematchVotes[voteIndex] ? 'Waiting for opponent…' : 'Request rematch';
}

function renderHistory(records, offset, total) {
  history.replaceChildren();
  moveCount.textContent = `${total} ${total === 1 ? 'move' : 'moves'}`;
  if (total === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-history';
    empty.textContent = 'Moves will appear here.';
    history.append(empty);
    return;
  }
  for (let index = 0; index < records.length; index += 2) {
    const item = document.createElement('li');
    const number = document.createElement('span');
    const whiteMove = document.createElement('span');
    const blackMove = document.createElement('span');
    number.className = 'number';
    whiteMove.className = 'move-cell';
    blackMove.className = 'move-cell';
    number.textContent = `${Math.floor((offset + index) / 2) + 1}.`;
    whiteMove.textContent = records[index] ?? '';
    blackMove.textContent = records[index + 1] ?? '';
    item.append(number, whiteMove, blackMove);
    history.append(item);
  }
  history.scrollTop = history.scrollHeight;
}

function playerState(view, color) {
  if (view.winner === view.players[color === 'white' ? 0 : 1].id) return 'Winner';
  if (view.status !== 'playing') return 'Finished';
  if (view.turnColor !== color) return 'Waiting';
  return view.inCheck ? 'In check' : 'To move';
}

function turnLabel(view) {
  if (view.status !== 'playing') return resultTitle(view);
  if (view.turn === view.viewer) return view.inCheck ? 'Your turn · Check' : 'Your turn';
  return view.inCheck ? 'Opponent in check' : "Opponent's turn";
}

function statusMessage(view, selectedSquare) {
  if (view.status !== 'playing') return resultMessage(view);
  if (view.canAcceptDraw) return 'Your opponent offered a draw. Accept or decline.';
  if (view.drawOfferBy === view.viewer) return 'Draw offered. Waiting for your opponent.';
  if (view.turn !== view.viewer) return 'Waiting for the next move.';
  if (selectedSquare !== null) return 'Choose a highlighted destination.';
  return view.inCheck ? 'Your king is in check. Choose a legal reply.' : 'Choose one of your pieces.';
}

function resultTitle(view) {
  if (view.status === 'checkmate') return view.winner === view.viewer ? 'Checkmate · You win' : 'Checkmate';
  if (view.status === 'resigned') return view.winner === view.viewer ? 'Opponent resigned' : 'You resigned';
  return 'Draw';
}

function resultMessage(view) {
  if (view.status === 'checkmate') return view.winner === view.viewer ? 'You delivered checkmate.' : 'Your king has no legal escape.';
  if (view.status === 'stalemate') return 'Stalemate. The player to move has no legal move.';
  if (view.status === 'drawRepetition') return 'Draw by threefold repetition.';
  if (view.status === 'drawFiftyMove') return 'Draw by the fifty-move rule.';
  if (view.status === 'drawInsufficientMaterial') return 'Draw by insufficient material.';
  if (view.status === 'drawAgreement') return 'Draw agreed by both players.';
  if (view.status === 'resigned') return view.winner === view.viewer ? 'Your opponent resigned.' : 'You resigned.';
  return 'Game finished.';
}

function showPromotion() {
  promotionFocus = document.activeElement;
  const color = latestView.myColor;
  for (const button of promotionChoices.querySelectorAll('button[data-promotion]')) {
    button.disabled = false;
    button.replaceChildren();
    const glyph = document.createElement('span');
    glyph.className = 'promotion-glyph';
    glyph.textContent = glyphs[color][button.dataset.promotion];
    glyph.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = button.dataset.promotion;
    button.append(glyph, label);
  }
  cancelPromotion.disabled = false;
  document.querySelector('main').inert = true;
  promotion.hidden = false;
  promotionChoices.querySelector('button')?.focus();
}

function hidePromotion() {
  pendingPromotion = null;
  promotion.hidden = true;
  document.querySelector('main').inert = false;
  promotionFocus?.focus();
  promotionFocus = null;
}

promotion.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    hidePromotion();
  } else if (event.key === 'Tab') {
    const controls = [...promotion.querySelectorAll('button:not(:disabled)')];
    const index = controls.indexOf(document.activeElement);
    const next = event.shiftKey ? (index + controls.length - 1) % controls.length : (index + 1) % controls.length;
    event.preventDefault();
    controls[next]?.focus();
  }
});

function squareName(square) {
  return `${String.fromCharCode(97 + square % 8)}${8 - Math.floor(square / 8)}`;
}
