const BOARD_SIZE = 8;
const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
const NO_FORCED_PIECE = 255;
const EMPTY = 0;
const ONE_MAN = 1;
const ONE_KING = 2;
const TWO_MAN = 3;
const TWO_KING = 4;
const DRAW_AFTER_NO_PROGRESS = 80;
const DIRECTIONS = Object.freeze([
  Object.freeze([-1, -1]),
  Object.freeze([-1, 1]),
  Object.freeze([1, -1]),
  Object.freeze([1, 1]),
]);

export function create({ players }) {
  if (players.length !== 2) throw new Error('Checkers requires exactly two players');
  return openingState(players.map((player) => player.id));
}

export function reduce({ state, playerId, action }) {
  const actorIndex = state.playerIds.indexOf(playerId);
  if (actorIndex < 0) return rejected('Unknown player');
  if (action === null || typeof action !== 'object' || typeof action.type !== 'string') {
    return rejected('Choose an action');
  }
  if (action.type === 'rematch') return voteForRematch(state, actorIndex);
  if (action.type === 'surrender') return surrender(state, actorIndex);
  if (action.type !== 'move') return rejected('Unknown action');
  if (state.finished) return rejected('The game is finished');
  if (state.turn !== playerId) return rejected('Wait for your turn');
  if (!Number.isInteger(action.from) || !Number.isInteger(action.to)) {
    return rejected('Choose a piece and a destination');
  }

  const from = action.from;
  const to = action.to;
  if (!isCell(from) || !isCell(to) || from === to) return rejected('Move is outside the board');
  if (state.forcedPiece !== NO_FORCED_PIECE && state.forcedPiece !== from) {
    return rejected('Continue the capture with the highlighted piece');
  }

  let piece = state.cells[from];
  const actor = actorIndex + 1;
  if (pieceActor(piece) !== actor) return rejected('Choose one of your pieces');
  if (state.cells[to] !== EMPTY) return rejected('That square is occupied');

  const fromRow = Math.floor(from / BOARD_SIZE);
  const fromColumn = from % BOARD_SIZE;
  const toRow = Math.floor(to / BOARD_SIZE);
  const toColumn = to % BOARD_SIZE;
  const rowDelta = toRow - fromRow;
  const columnDelta = toColumn - fromColumn;
  const rowDistance = Math.abs(rowDelta);
  if (rowDistance !== Math.abs(columnDelta) || !directionAllowed(piece, rowDelta)) {
    return rejected('Pieces move diagonally');
  }

  const captureRequired = state.forcedPiece !== NO_FORCED_PIECE || actorHasCapture(state, actor);
  const next = cloneState(state);
  if (rowDistance === 1) {
    if (captureRequired) return rejected('A capture is required');
    next.cells[from] = EMPTY;
    const advancedMan = !isKing(piece);
    const promoted = promote(piece, to);
    piece = promoted.piece;
    next.cells[to] = piece;
    next.noProgressMoves = advancedMan
      ? 0
      : Math.min(DRAW_AFTER_NO_PROGRESS, next.noProgressMoves + 1);
    const events = [{ type: promoted.didPromote ? 'promoted' : 'moved', actor, from, to }];
    completeTurn(next, actor, events);
    return accepted(next, events);
  }

  if (rowDistance !== 2) return rejected('Move one square or jump one piece');
  const middle = ((fromRow + toRow) / 2) * BOARD_SIZE + ((fromColumn + toColumn) / 2);
  if (pieceActor(next.cells[middle]) !== otherActor(actor)) return rejected('A jump must capture an opponent');

  next.cells[from] = EMPTY;
  next.cells[middle] = EMPTY;
  const promoted = promote(piece, to);
  piece = promoted.piece;
  next.cells[to] = piece;
  next.noProgressMoves = 0;
  const events = [{
    type: promoted.didPromote ? 'promoted' : 'captured',
    actor,
    from,
    to,
    captured: middle,
  }];

  // American checkers ends the capture sequence immediately on crowning.
  if (!promoted.didPromote && hasCaptureFrom(next, to)) {
    next.forcedPiece = to;
    events[0].continued = true;
    return accepted(next, events);
  }
  completeTurn(next, actor, events);
  return accepted(next, events);
}

export function view({ state, viewer, revision }) {
  const mySide = state.playerIds.indexOf(viewer) + 1;
  const legalMoves = !state.finished && state.turn === viewer
    ? legalMovesForActor(state, mySide)
    : [];
  return {
    cells: [...state.cells],
    turn: state.turn,
    winner: state.winner,
    draw: state.draw,
    finished: state.finished,
    finishReason: state.finishReason ?? null,
    forcedPiece: state.forcedPiece,
    noProgressMoves: state.noProgressMoves,
    rematchVotes: [...state.rematchVotes],
    viewer,
    mySide,
    legalMoves: legalMoves.map((move) => ({ ...move })),
    captureRequired: legalMoves.some((move) => move.capture),
    canSurrender: !state.finished && mySide !== 0,
    canRequestRematch: state.finished && mySide !== 0 && !state.rematchVotes[mySide - 1],
    revision,
  };
}

function openingState(playerIds) {
  const cells = Array(BOARD_CELLS).fill(EMPTY);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < BOARD_SIZE; column += 1) {
      if ((row + column) % 2 !== 0) cells[row * BOARD_SIZE + column] = TWO_MAN;
    }
  }
  for (let row = 5; row < BOARD_SIZE; row += 1) {
    for (let column = 0; column < BOARD_SIZE; column += 1) {
      if ((row + column) % 2 !== 0) cells[row * BOARD_SIZE + column] = ONE_MAN;
    }
  }
  return {
    cells,
    playerIds: [...playerIds],
    turn: playerIds[0],
    winner: null,
    draw: false,
    finished: false,
    finishReason: null,
    forcedPiece: NO_FORCED_PIECE,
    noProgressMoves: 0,
    rematchVotes: [false, false],
  };
}

function surrender(state, actorIndex) {
  if (state.finished) return rejected('The game is finished');
  const next = cloneState(state);
  next.finished = true;
  next.finishReason = 'surrender';
  next.turn = null;
  next.winner = next.playerIds[actorIndex === 0 ? 1 : 0];
  next.draw = false;
  next.forcedPiece = NO_FORCED_PIECE;
  return accepted(next, [{ type: 'surrendered', actor: actorIndex + 1 }]);
}

function voteForRematch(state, actorIndex) {
  if (!state.finished) return rejected('Finish the game before requesting a rematch');
  if (state.rematchVotes[actorIndex]) return rejected('Rematch already requested');
  const next = cloneState(state);
  next.rematchVotes[actorIndex] = true;
  if (!next.rematchVotes.every(Boolean)) {
    return accepted(next, [{ type: 'rematchWaiting', actor: actorIndex + 1 }]);
  }
  return accepted(openingState(state.playerIds), [{ type: 'rematchStarted' }]);
}

function completeTurn(state, actor, events) {
  state.forcedPiece = NO_FORCED_PIECE;
  const opponent = otherActor(actor);
  if (!actorHasMove(state, opponent)) {
    state.finished = true;
    state.finishReason = 'blocked';
    state.turn = null;
    state.winner = state.playerIds[actor - 1];
    state.draw = false;
    events.push({ type: 'victory', actor });
    return;
  }
  if (state.noProgressMoves >= DRAW_AFTER_NO_PROGRESS) {
    state.finished = true;
    state.finishReason = 'noProgress';
    state.turn = null;
    state.winner = null;
    state.draw = true;
    events.push({ type: 'draw' });
    return;
  }
  state.turn = state.playerIds[opponent - 1];
}

function legalMovesForActor(state, actor) {
  if (actor !== 1 && actor !== 2) return [];
  if (state.forcedPiece !== NO_FORCED_PIECE) return capturesFrom(state, state.forcedPiece);
  const captureRequired = actorHasCapture(state, actor);
  const moves = [];
  for (let from = 0; from < BOARD_CELLS; from += 1) {
    if (pieceActor(state.cells[from]) !== actor) continue;
    moves.push(...(captureRequired ? capturesFrom(state, from) : simpleMovesFrom(state, from)));
  }
  return moves;
}

function capturesFrom(state, from) {
  if (!isCell(from)) return [];
  const piece = state.cells[from];
  const actor = pieceActor(piece);
  if (actor === 0) return [];
  const row = Math.floor(from / BOARD_SIZE);
  const column = from % BOARD_SIZE;
  const moves = [];
  for (const [rowStep, columnStep] of DIRECTIONS) {
    if (!directionAllowed(piece, rowStep)) continue;
    const middleRow = row + rowStep;
    const middleColumn = column + columnStep;
    const landingRow = row + rowStep * 2;
    const landingColumn = column + columnStep * 2;
    if (!inBounds(landingRow, landingColumn)) continue;
    const middle = middleRow * BOARD_SIZE + middleColumn;
    const to = landingRow * BOARD_SIZE + landingColumn;
    if (pieceActor(state.cells[middle]) === otherActor(actor) && state.cells[to] === EMPTY) {
      moves.push({ from, to, capture: true, captured: middle });
    }
  }
  return moves;
}

function simpleMovesFrom(state, from) {
  if (!isCell(from)) return [];
  const piece = state.cells[from];
  if (pieceActor(piece) === 0) return [];
  const row = Math.floor(from / BOARD_SIZE);
  const column = from % BOARD_SIZE;
  const moves = [];
  for (const [rowStep, columnStep] of DIRECTIONS) {
    if (!directionAllowed(piece, rowStep)) continue;
    const targetRow = row + rowStep;
    const targetColumn = column + columnStep;
    if (!inBounds(targetRow, targetColumn)) continue;
    const to = targetRow * BOARD_SIZE + targetColumn;
    if (state.cells[to] === EMPTY) moves.push({ from, to, capture: false });
  }
  return moves;
}

function actorHasCapture(state, actor) {
  for (let cell = 0; cell < BOARD_CELLS; cell += 1) {
    if (pieceActor(state.cells[cell]) === actor && hasCaptureFrom(state, cell)) return true;
  }
  return false;
}

function hasCaptureFrom(state, from) {
  return capturesFrom(state, from).length !== 0;
}

function actorHasMove(state, actor) {
  if (actorHasCapture(state, actor)) return true;
  for (let cell = 0; cell < BOARD_CELLS; cell += 1) {
    if (pieceActor(state.cells[cell]) === actor && simpleMovesFrom(state, cell).length !== 0) return true;
  }
  return false;
}

function pieceActor(piece) {
  if (piece === ONE_MAN || piece === ONE_KING) return 1;
  if (piece === TWO_MAN || piece === TWO_KING) return 2;
  return 0;
}

function isKing(piece) {
  return piece === ONE_KING || piece === TWO_KING;
}

function directionAllowed(piece, rowDelta) {
  if (isKing(piece)) return rowDelta !== 0;
  return piece === ONE_MAN ? rowDelta < 0 : rowDelta > 0;
}

function promote(piece, destination) {
  const row = Math.floor(destination / BOARD_SIZE);
  if (piece === ONE_MAN && row === 0) return { piece: ONE_KING, didPromote: true };
  if (piece === TWO_MAN && row === BOARD_SIZE - 1) return { piece: TWO_KING, didPromote: true };
  return { piece, didPromote: false };
}

function inBounds(row, column) {
  return row >= 0 && row < BOARD_SIZE && column >= 0 && column < BOARD_SIZE;
}

function isCell(cell) {
  return Number.isInteger(cell) && cell >= 0 && cell < BOARD_CELLS;
}

function otherActor(actor) {
  return actor === 1 ? 2 : 1;
}

function cloneState(state) {
  return {
    ...state,
    cells: [...state.cells],
    playerIds: [...state.playerIds],
    rematchVotes: [...state.rematchVotes],
  };
}

function accepted(state, events) {
  return { accepted: true, state, events };
}

function rejected(reason) {
  return { accepted: false, reason };
}
