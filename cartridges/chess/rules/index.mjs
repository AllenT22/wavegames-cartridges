const BOARD_CELLS = 64;
const COLORS = Object.freeze(['white', 'black']);
const PROMOTIONS = Object.freeze(['queen', 'rook', 'bishop', 'knight']);
const SQUARE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const VIEW_HISTORY_PLIES = 64;
const FINISHED_STATUSES = new Set([
  'checkmate',
  'stalemate',
  'drawRepetition',
  'drawFiftyMove',
  'drawInsufficientMaterial',
  'drawAgreement',
  'resigned',
]);

export function create({ players }) {
  if (!Array.isArray(players) || players.length !== 2) {
    throw new Error('Chess requires exactly two players');
  }
  return openingState(players.map((player) => player.id));
}

export function reduce({ state, playerId, action }) {
  const actorIndex = state.playerIds.indexOf(playerId);
  if (actorIndex < 0) return rejected('Unknown player');
  if (action === null || typeof action !== 'object' || Array.isArray(action) || typeof action.type !== 'string') {
    return rejected('Choose an action');
  }

  if (action.type === 'rematch') return voteForRematch(state, actorIndex);
  if (action.type === 'resign') return resign(state, actorIndex);
  if (action.type === 'offerDraw') return offerDraw(state, playerId);
  if (action.type === 'acceptDraw') return acceptDraw(state, playerId);
  if (action.type === 'declineDraw') return declineDraw(state, playerId);
  if (action.type !== 'move') return rejected('Unknown action');
  if (isFinished(state)) return rejected('The game is finished');
  if (state.turn !== playerId) return rejected('Wait for your turn');
  if (!Number.isInteger(action.from) || !Number.isInteger(action.to)) {
    return rejected('Choose a piece and a destination');
  }
  if (!isSquare(action.from) || !isSquare(action.to) || action.from === action.to) {
    return rejected('Move is outside the board');
  }
  if (action.promotion !== undefined && !PROMOTIONS.includes(action.promotion)) {
    return rejected('Choose queen, rook, bishop, or knight');
  }

  const candidates = legalMovesFrom(state, action.from).filter((move) => move.to === action.to);
  if (candidates.length === 0) return rejected('That move is not legal');
  if (candidates.some((move) => move.promotion !== null) && action.promotion === undefined) {
    return rejected('Choose a promotion piece');
  }
  const move = candidates.find((candidate) => candidate.promotion === (action.promotion ?? null));
  if (!move) return rejected('That promotion is not legal');

  const next = applyLegalMove(state, move);
  const record = next.lastMove;
  const eventType = next.status === 'checkmate'
    ? 'checkmate'
    : isDrawStatus(next.status)
      ? 'draw'
      : isInCheck(next, next.turnColor)
        ? 'check'
        : 'moved';
  return accepted(next, [{
    type: eventType,
    color: colorForPlayer(state, playerId),
    from: move.from,
    to: move.to,
    notation: record.notation,
  }]);
}

export function view({ state, viewer, players, revision }) {
  const myColor = colorForPlayer(state, viewer);
  const active = !isFinished(state);
  const myTurn = active && state.turn === viewer;
  const playerNames = new Map((players ?? []).map((player) => [player.id, player.name]));
  let historyOffset = Math.max(0, state.history.length - VIEW_HISTORY_PLIES);
  if (historyOffset % 2 !== 0) historyOffset += 1;
  const visibleHistory = state.history.slice(historyOffset);
  return {
    board: state.board.map(pieceCode).join(''),
    turn: state.turn,
    turnColor: state.turnColor,
    status: state.status,
    winner: state.winner,
    inCheck: active && isInCheck(state, state.turnColor),
    halfmoveClock: state.halfmoveClock,
    fullmoveNumber: state.fullmoveNumber,
    history: visibleHistory.join(' '),
    historyOffset,
    moveCount: state.history.length,
    lastMove: state.lastMove === null ? null : [state.lastMove.from, state.lastMove.to],
    drawOfferBy: state.drawOfferBy,
    rematchVotes: [...state.rematchVotes],
    viewer,
    myColor,
    players: [
      { id: state.playerIds[0], name: playerNames.get(state.playerIds[0]) ?? 'White' },
      { id: state.playerIds[1], name: playerNames.get(state.playerIds[1]) ?? 'Black' },
    ],
    legalMoves: myTurn ? allLegalMoves(state).map(encodeMove).join('') : '',
    canResign: active && myColor !== null,
    canOfferDraw: active && myColor !== null && state.drawOfferBy === null,
    canAcceptDraw: active && state.drawOfferBy !== null && state.drawOfferBy !== viewer,
    canDeclineDraw: active && state.drawOfferBy !== null && state.drawOfferBy !== viewer,
    canRequestRematch: !active && myColor !== null && !state.rematchVotes[myColor === 'white' ? 0 : 1],
    revision,
  };
}

function openingState(playerIds) {
  const state = {
    board: initialBoard(),
    playerIds: [...playerIds],
    turn: playerIds[0],
    turnColor: 'white',
    status: 'playing',
    winner: null,
    whiteCanCastleKingSide: true,
    whiteCanCastleQueenSide: true,
    blackCanCastleKingSide: true,
    blackCanCastleQueenSide: true,
    enPassantTarget: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
    history: [],
    lastMove: null,
    positionCounts: {},
    drawOfferBy: null,
    rematchVotes: [false, false],
  };
  state.positionCounts[positionSignature(state)] = 1;
  return state;
}

function initialBoard() {
  const backRank = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
  return Array.from({ length: BOARD_CELLS }, (_, square) => {
    const row = Math.floor(square / 8);
    const column = square % 8;
    if (row === 0) return piece('black', backRank[column]);
    if (row === 1) return piece('black', 'pawn');
    if (row === 6) return piece('white', 'pawn');
    if (row === 7) return piece('white', backRank[column]);
    return null;
  });
}

function voteForRematch(state, actorIndex) {
  if (!isFinished(state)) return rejected('Finish the game before requesting a rematch');
  if (state.rematchVotes[actorIndex]) return rejected('Rematch already requested');
  const votes = [...state.rematchVotes];
  votes[actorIndex] = true;
  if (!votes.every(Boolean)) {
    return accepted({ ...cloneState(state), rematchVotes: votes }, [{ type: 'rematchWaiting', actor: actorIndex + 1 }]);
  }
  const next = openingState([state.playerIds[1], state.playerIds[0]]);
  return accepted(next, [{ type: 'rematchStarted', whitePlayerId: next.playerIds[0] }]);
}

function resign(state, actorIndex) {
  if (isFinished(state)) return rejected('The game is finished');
  const next = cloneState(state);
  next.status = 'resigned';
  next.winner = state.playerIds[actorIndex === 0 ? 1 : 0];
  next.drawOfferBy = null;
  return accepted(next, [{ type: 'resigned', actor: actorIndex + 1 }]);
}

function offerDraw(state, playerId) {
  if (isFinished(state)) return rejected('The game is finished');
  if (state.drawOfferBy === playerId) return rejected('Draw already offered');
  if (state.drawOfferBy !== null) return rejected('Answer the pending draw offer');
  const next = cloneState(state);
  next.drawOfferBy = playerId;
  return accepted(next, [{ type: 'drawOffered', playerId }]);
}

function acceptDraw(state, playerId) {
  if (isFinished(state)) return rejected('The game is finished');
  if (state.drawOfferBy === null) return rejected('There is no draw offer');
  if (state.drawOfferBy === playerId) return rejected('The other player must accept');
  const next = cloneState(state);
  next.status = 'drawAgreement';
  next.winner = null;
  next.drawOfferBy = null;
  return accepted(next, [{ type: 'drawAgreed' }]);
}

function declineDraw(state, playerId) {
  if (isFinished(state)) return rejected('The game is finished');
  if (state.drawOfferBy === null) return rejected('There is no draw offer');
  if (state.drawOfferBy === playerId) return rejected('The other player must answer');
  const next = cloneState(state);
  next.drawOfferBy = null;
  return accepted(next, [{ type: 'drawDeclined', playerId }]);
}

function applyLegalMove(state, move) {
  const moved = state.board[move.from];
  const board = state.board.map((entry) => entry === null ? null : { ...entry });
  let captured = board[move.to];
  board[move.from] = null;
  if (move.isEnPassant) {
    const capturedSquare = move.to + (moved.color === 'white' ? 8 : -8);
    captured = board[capturedSquare];
    board[capturedSquare] = null;
  }
  board[move.to] = piece(moved.color, move.promotion ?? moved.type);
  if (move.isCastle) {
    const kingSide = move.to % 8 === 6;
    const row = Math.floor(move.to / 8);
    const rookFrom = row * 8 + (kingSide ? 7 : 0);
    const rookTo = row * 8 + (kingSide ? 5 : 3);
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  }

  let whiteKing = state.whiteCanCastleKingSide;
  let whiteQueen = state.whiteCanCastleQueenSide;
  let blackKing = state.blackCanCastleKingSide;
  let blackQueen = state.blackCanCastleQueenSide;
  if (moved.type === 'king') {
    if (moved.color === 'white') {
      whiteKing = false;
      whiteQueen = false;
    } else {
      blackKing = false;
      blackQueen = false;
    }
  }
  if (move.from === 56 || move.to === 56) whiteQueen = false;
  if (move.from === 63 || move.to === 63) whiteKing = false;
  if (move.from === 0 || move.to === 0) blackQueen = false;
  if (move.from === 7 || move.to === 7) blackKing = false;

  const pawnMove = moved.type === 'pawn';
  const enPassantTarget = pawnMove && Math.abs(move.from - move.to) === 16
    ? Math.floor((move.from + move.to) / 2)
    : null;
  const nextColor = opposite(moved.color);
  const next = {
    ...cloneState(state),
    board,
    turnColor: nextColor,
    turn: playerIdForColor(state, nextColor),
    whiteCanCastleKingSide: whiteKing,
    whiteCanCastleQueenSide: whiteQueen,
    blackCanCastleKingSide: blackKing,
    blackCanCastleQueenSide: blackQueen,
    enPassantTarget,
    halfmoveClock: pawnMove || captured !== null ? 0 : state.halfmoveClock + 1,
    fullmoveNumber: state.fullmoveNumber + (moved.color === 'black' ? 1 : 0),
    drawOfferBy: null,
    lastMove: null,
  };

  // A pawn move or capture is irreversible, so earlier positions can never
  // participate in a future threefold repetition. Pruning them keeps the
  // serialized authority state bounded for arbitrarily long games.
  if (pawnMove || captured !== null) next.positionCounts = {};
  const signature = positionSignature(next);
  next.positionCounts[signature] = (next.positionCounts[signature] ?? 0) + 1;
  const opponentInCheck = isInCheck(next, next.turnColor);
  const noMoves = allLegalMoves(next).length === 0;
  if (noMoves && opponentInCheck) {
    next.status = 'checkmate';
    next.winner = playerIdForColor(state, moved.color);
  } else if (noMoves) {
    next.status = 'stalemate';
    next.winner = null;
  } else if (next.halfmoveClock >= 100) {
    next.status = 'drawFiftyMove';
    next.winner = null;
  } else if (next.positionCounts[signature] >= 3) {
    next.status = 'drawRepetition';
    next.winner = null;
  } else if (hasInsufficientMaterial(next.board)) {
    next.status = 'drawInsufficientMaterial';
    next.winner = null;
  } else {
    next.status = 'playing';
    next.winner = null;
  }

  const record = {
    from: move.from,
    to: move.to,
    notation: notation({ before: state, after: next, move, moved, captured }),
    piece: { ...moved },
    captured: captured === null ? null : { ...captured },
    promotion: move.promotion,
  };
  next.history.push(record.notation);
  next.lastMove = record;
  return next;
}

function allLegalMoves(state) {
  if (isFinished(state)) return [];
  const result = [];
  for (let square = 0; square < BOARD_CELLS; square += 1) {
    if (state.board[square]?.color === state.turnColor) result.push(...legalMovesFrom(state, square));
  }
  return result;
}

function legalMovesFrom(state, from) {
  if (isFinished(state) || !isSquare(from)) return [];
  const moved = state.board[from];
  if (moved === null || moved.color !== state.turnColor) return [];
  return pseudoMoves(state, from, true).filter((move) => !leavesKingInCheck(state, move));
}

function pseudoMoves(state, from, includeCastling) {
  const moved = state.board[from];
  switch (moved.type) {
    case 'pawn': return pawnMoves(state, from, moved);
    case 'knight': return jumpMoves(state, from, moved, [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]);
    case 'bishop': return slideMoves(state, from, moved, [[-1, -1], [-1, 1], [1, -1], [1, 1]]);
    case 'rook': return slideMoves(state, from, moved, [[-1, 0], [1, 0], [0, -1], [0, 1]]);
    case 'queen': return slideMoves(state, from, moved, [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]);
    case 'king': return [
      ...jumpMoves(state, from, moved, [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]),
      ...(includeCastling ? castleMoves(state, from, moved) : []),
    ];
    default: return [];
  }
}

function pawnMoves(state, from, moved) {
  const result = [];
  const row = Math.floor(from / 8);
  const column = from % 8;
  const direction = moved.color === 'white' ? -1 : 1;
  const startRow = moved.color === 'white' ? 6 : 1;
  const promotionRow = moved.color === 'white' ? 0 : 7;
  const nextRow = row + direction;
  if (!inside(nextRow, column)) return result;
  const one = nextRow * 8 + column;
  if (state.board[one] === null) {
    addPawnMove(result, from, one, nextRow === promotionRow);
    const twoRow = row + direction * 2;
    const two = twoRow * 8 + column;
    if (row === startRow && state.board[two] === null) result.push(move(from, two));
  }
  for (const delta of [-1, 1]) {
    const targetColumn = column + delta;
    if (!inside(nextRow, targetColumn)) continue;
    const target = nextRow * 8 + targetColumn;
    const occupant = state.board[target];
    if (occupant !== null && occupant.color !== moved.color && occupant.type !== 'king') {
      addPawnMove(result, from, target, nextRow === promotionRow);
    } else if (target === state.enPassantTarget) {
      const capturedSquare = target + (moved.color === 'white' ? 8 : -8);
      const captured = state.board[capturedSquare];
      if (captured?.color === opposite(moved.color) && captured?.type === 'pawn') {
        result.push(move(from, target, null, true));
      }
    }
  }
  return result;
}

function addPawnMove(result, from, to, promotion) {
  if (!promotion) {
    result.push(move(from, to));
    return;
  }
  for (const type of PROMOTIONS) result.push(move(from, to, type));
}

function jumpMoves(state, from, moved, offsets) {
  const result = [];
  const row = Math.floor(from / 8);
  const column = from % 8;
  for (const [rowDelta, columnDelta] of offsets) {
    const targetRow = row + rowDelta;
    const targetColumn = column + columnDelta;
    if (!inside(targetRow, targetColumn)) continue;
    const target = targetRow * 8 + targetColumn;
    const occupant = state.board[target];
    if (occupant === null || (occupant.color !== moved.color && occupant.type !== 'king')) {
      result.push(move(from, target));
    }
  }
  return result;
}

function slideMoves(state, from, moved, directions) {
  const result = [];
  const row = Math.floor(from / 8);
  const column = from % 8;
  for (const [rowDelta, columnDelta] of directions) {
    let targetRow = row + rowDelta;
    let targetColumn = column + columnDelta;
    while (inside(targetRow, targetColumn)) {
      const target = targetRow * 8 + targetColumn;
      const occupant = state.board[target];
      if (occupant === null) {
        result.push(move(from, target));
      } else {
        if (occupant.color !== moved.color && occupant.type !== 'king') result.push(move(from, target));
        break;
      }
      targetRow += rowDelta;
      targetColumn += columnDelta;
    }
  }
  return result;
}

function castleMoves(state, from, king) {
  const row = king.color === 'white' ? 7 : 0;
  if (from !== row * 8 + 4 || isInCheck(state, king.color)) return [];
  const result = [];
  const kingAllowed = king.color === 'white' ? state.whiteCanCastleKingSide : state.blackCanCastleKingSide;
  const queenAllowed = king.color === 'white' ? state.whiteCanCastleQueenSide : state.blackCanCastleQueenSide;
  if (
    kingAllowed &&
    state.board[row * 8 + 5] === null &&
    state.board[row * 8 + 6] === null &&
    samePiece(state.board[row * 8 + 7], piece(king.color, 'rook')) &&
    !isSquareAttacked(state, row * 8 + 5, opposite(king.color)) &&
    !isSquareAttacked(state, row * 8 + 6, opposite(king.color))
  ) {
    result.push(move(from, row * 8 + 6, null, false, true));
  }
  if (
    queenAllowed &&
    state.board[row * 8 + 1] === null &&
    state.board[row * 8 + 2] === null &&
    state.board[row * 8 + 3] === null &&
    samePiece(state.board[row * 8], piece(king.color, 'rook')) &&
    !isSquareAttacked(state, row * 8 + 3, opposite(king.color)) &&
    !isSquareAttacked(state, row * 8 + 2, opposite(king.color))
  ) {
    result.push(move(from, row * 8 + 2, null, false, true));
  }
  return result;
}

function leavesKingInCheck(state, candidate) {
  const moved = state.board[candidate.from];
  const board = state.board.map((entry) => entry === null ? null : { ...entry });
  board[candidate.from] = null;
  if (candidate.isEnPassant) board[candidate.to + (moved.color === 'white' ? 8 : -8)] = null;
  board[candidate.to] = piece(moved.color, candidate.promotion ?? moved.type);
  if (candidate.isCastle) {
    const row = Math.floor(candidate.to / 8);
    const kingSide = candidate.to % 8 === 6;
    const rookFrom = row * 8 + (kingSide ? 7 : 0);
    const rookTo = row * 8 + (kingSide ? 5 : 3);
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  }
  return isInCheck({ ...state, board }, moved.color);
}

function isInCheck(state, color) {
  const king = state.board.findIndex((entry) => entry?.color === color && entry?.type === 'king');
  return king < 0 || isSquareAttacked(state, king, opposite(color));
}

function isSquareAttacked(state, square, byColor) {
  for (let from = 0; from < BOARD_CELLS; from += 1) {
    const attacker = state.board[from];
    if (attacker !== null && attacker.color === byColor && attacksSquare(state, from, square)) return true;
  }
  return false;
}

function attacksSquare(state, from, target) {
  const attacker = state.board[from];
  const fromRow = Math.floor(from / 8);
  const fromColumn = from % 8;
  const targetRow = Math.floor(target / 8);
  const targetColumn = target % 8;
  const rowDelta = targetRow - fromRow;
  const columnDelta = targetColumn - fromColumn;
  if (attacker.type === 'pawn') return rowDelta === (attacker.color === 'white' ? -1 : 1) && Math.abs(columnDelta) === 1;
  if (attacker.type === 'knight') return (Math.abs(rowDelta) === 2 && Math.abs(columnDelta) === 1) || (Math.abs(rowDelta) === 1 && Math.abs(columnDelta) === 2);
  if (attacker.type === 'king') return Math.abs(rowDelta) <= 1 && Math.abs(columnDelta) <= 1;
  if (attacker.type === 'bishop') return Math.abs(rowDelta) === Math.abs(columnDelta) && rayClear(state.board, fromRow, fromColumn, targetRow, targetColumn);
  if (attacker.type === 'rook') return (rowDelta === 0 || columnDelta === 0) && rayClear(state.board, fromRow, fromColumn, targetRow, targetColumn);
  if (attacker.type === 'queen') return (rowDelta === 0 || columnDelta === 0 || Math.abs(rowDelta) === Math.abs(columnDelta)) && rayClear(state.board, fromRow, fromColumn, targetRow, targetColumn);
  return false;
}

function rayClear(board, fromRow, fromColumn, targetRow, targetColumn) {
  const rowStep = Math.sign(targetRow - fromRow);
  const columnStep = Math.sign(targetColumn - fromColumn);
  let row = fromRow + rowStep;
  let column = fromColumn + columnStep;
  while (row !== targetRow || column !== targetColumn) {
    if (board[row * 8 + column] !== null) return false;
    row += rowStep;
    column += columnStep;
  }
  return true;
}

function hasInsufficientMaterial(board) {
  const material = [];
  for (let index = 0; index < board.length; index += 1) {
    const entry = board[index];
    if (entry !== null && entry.type !== 'king') material.push({ index, piece: entry });
  }
  if (material.length === 0) return true;
  if (material.length === 1) return material[0].piece.type === 'bishop' || material[0].piece.type === 'knight';
  if (material.every((entry) => entry.piece.type === 'bishop')) {
    return new Set(material.map((entry) => (Math.floor(entry.index / 8) + entry.index % 8) & 1)).size === 1;
  }
  return false;
}

function positionSignature(state) {
  const board = state.board.map((entry) => entry === null ? '.' : signaturePiece(entry)).join('');
  const castling = `${state.whiteCanCastleKingSide ? 'K' : ''}${state.whiteCanCastleQueenSide ? 'Q' : ''}${state.blackCanCastleKingSide ? 'k' : ''}${state.blackCanCastleQueenSide ? 'q' : ''}`;
  return `${board}|${state.turnColor}|${castling}|${effectiveEnPassantTarget(state) ?? '-'}`;
}

function effectiveEnPassantTarget(state) {
  const target = state.enPassantTarget;
  if (target === null) return null;
  const targetRow = Math.floor(target / 8);
  const targetColumn = target % 8;
  const sourceRow = targetRow + (state.turnColor === 'white' ? 1 : -1);
  for (const delta of [-1, 1]) {
    const sourceColumn = targetColumn + delta;
    if (!inside(sourceRow, sourceColumn)) continue;
    const from = sourceRow * 8 + sourceColumn;
    if (samePiece(state.board[from], piece(state.turnColor, 'pawn'))) {
      const candidate = move(from, target, null, true);
      if (!leavesKingInCheck(state, candidate)) return target;
    }
  }
  return null;
}

function notation({ before, after, move: candidate, moved, captured }) {
  if (candidate.isCastle) {
    return `${candidate.to % 8 === 6 ? 'O-O' : 'O-O-O'}${checkSuffix(after)}`;
  }
  let value = '';
  if (moved.type !== 'pawn') {
    value += pieceLetter(moved.type);
    const ambiguous = [];
    for (let square = 0; square < BOARD_CELLS; square += 1) {
      if (square !== candidate.from && samePiece(before.board[square], moved)) {
        ambiguous.push(...legalMovesFrom(before, square).filter((other) => other.to === candidate.to));
      }
    }
    if (ambiguous.length > 0) {
      const sameFile = ambiguous.some((other) => other.from % 8 === candidate.from % 8);
      const sameRank = ambiguous.some((other) => Math.floor(other.from / 8) === Math.floor(candidate.from / 8));
      value += !sameFile ? String.fromCharCode(97 + candidate.from % 8) : !sameRank ? String(8 - Math.floor(candidate.from / 8)) : squareName(candidate.from);
    }
  } else if (captured !== null || candidate.isEnPassant) {
    value += String.fromCharCode(97 + candidate.from % 8);
  }
  if (captured !== null || candidate.isEnPassant) value += 'x';
  value += squareName(candidate.to);
  if (candidate.promotion !== null) value += `=${pieceLetter(candidate.promotion)}`;
  return value + checkSuffix(after);
}

function checkSuffix(state) {
  if (state.status === 'checkmate') return '#';
  return isInCheck(state, state.turnColor) ? '+' : '';
}

function createPosition({ playerIds = ['player-1', 'player-2'], pieces = {}, turnColor = 'white', castling = {}, enPassantTarget = null, halfmoveClock = 0, fullmoveNumber = 1, positionCounts = null }) {
  if (!Array.isArray(playerIds) || playerIds.length !== 2 || !COLORS.includes(turnColor)) throw new Error('Invalid test position');
  const board = Array(BOARD_CELLS).fill(null);
  for (const [name, entry] of Object.entries(pieces)) {
    if (!COLORS.includes(entry.color) || !['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'].includes(entry.type)) throw new Error(`Invalid piece at ${name}`);
    board[squareIndex(name)] = piece(entry.color, entry.type);
  }
  const state = {
    board,
    playerIds: [...playerIds],
    turnColor,
    turn: turnColor === 'white' ? playerIds[0] : playerIds[1],
    status: 'playing',
    winner: null,
    whiteCanCastleKingSide: castling.whiteKingSide ?? true,
    whiteCanCastleQueenSide: castling.whiteQueenSide ?? true,
    blackCanCastleKingSide: castling.blackKingSide ?? true,
    blackCanCastleQueenSide: castling.blackQueenSide ?? true,
    enPassantTarget: typeof enPassantTarget === 'string' ? squareIndex(enPassantTarget) : enPassantTarget,
    halfmoveClock,
    fullmoveNumber,
    history: [],
    lastMove: null,
    positionCounts: positionCounts === null ? {} : { ...positionCounts },
    drawOfferBy: null,
    rematchVotes: [false, false],
  };
  const signature = positionSignature(state);
  if (positionCounts === null) state.positionCounts[signature] = 1;
  return state;
}

function applyMoveForTesting(state, from, to, promotion = null) {
  const fromIndex = typeof from === 'string' ? squareIndex(from) : from;
  const toIndex = typeof to === 'string' ? squareIndex(to) : to;
  const candidate = legalMovesFrom(state, fromIndex).find((entry) => entry.to === toIndex && entry.promotion === promotion);
  if (!candidate) throw new Error(`No legal move ${squareName(fromIndex)}-${squareName(toIndex)}${promotion ? `=${promotion}` : ''}`);
  return applyLegalMove(state, candidate);
}

function cloneState(state) {
  return {
    ...state,
    board: state.board.map((entry) => entry === null ? null : { ...entry }),
    playerIds: [...state.playerIds],
    history: [...state.history],
    lastMove: state.lastMove === null ? null : { ...state.lastMove, piece: { ...state.lastMove.piece }, captured: state.lastMove.captured === null ? null : { ...state.lastMove.captured } },
    positionCounts: { ...state.positionCounts },
    rematchVotes: [...state.rematchVotes],
  };
}

function accepted(state, events) { return { accepted: true, state, events }; }
function rejected(reason) { return { accepted: false, reason }; }
function isFinished(state) { return FINISHED_STATUSES.has(state.status); }
function isDrawStatus(status) { return status.startsWith('draw') || status === 'stalemate'; }
function isSquare(value) { return Number.isInteger(value) && value >= 0 && value < BOARD_CELLS; }
function inside(row, column) { return row >= 0 && row < 8 && column >= 0 && column < 8; }
function opposite(color) { return color === 'white' ? 'black' : 'white'; }
function piece(color, type) { return { color, type }; }
function samePiece(left, right) { return left !== null && right !== null && left.color === right.color && left.type === right.type; }
function move(from, to, promotion = null, isEnPassant = false, isCastle = false) { return { from, to, promotion, isEnPassant, isCastle }; }
function encodeMove(candidate) {
  const flag = candidate.promotion !== null
    ? ['Q', 'R', 'B', 'N'][PROMOTIONS.indexOf(candidate.promotion)]
    : candidate.isEnPassant
      ? 'E'
      : candidate.isCastle
        ? 'C'
        : '.';
  return `${SQUARE_ALPHABET[candidate.from]}${SQUARE_ALPHABET[candidate.to]}${flag}`;
}
function pieceCode(entry) {
  if (entry === null) return '.';
  return signaturePiece(entry);
}
function playerIdForColor(state, color) { return state.playerIds[color === 'white' ? 0 : 1]; }
function colorForPlayer(state, playerId) { return state.playerIds[0] === playerId ? 'white' : state.playerIds[1] === playerId ? 'black' : null; }
function squareName(square) { return `${String.fromCharCode(97 + square % 8)}${8 - Math.floor(square / 8)}`; }
function squareIndex(name) {
  if (typeof name !== 'string' || !/^[a-h][1-8]$/.test(name)) throw new Error(`Invalid square: ${name}`);
  return (8 - Number(name[1])) * 8 + name.charCodeAt(0) - 97;
}
function pieceLetter(type) { return ({ king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: '' })[type]; }
function signaturePiece(entry) {
  const letter = ({ king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p' })[entry.type];
  return entry.color === 'white' ? letter.toUpperCase() : letter;
}

export const __testing = Object.freeze({
  allLegalMoves,
  applyMove: applyMoveForTesting,
  createPosition,
  hasInsufficientMaterial,
  isInCheck,
  legalMovesFrom,
  positionSignature,
  squareIndex,
  squareName,
});
