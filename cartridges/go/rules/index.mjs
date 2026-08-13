export const BOARD_SIZE = 19;
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
export const KOMI_HALF_POINTS = 13;

const EMPTY = '.';
const BLACK = 'b';
const WHITE = 'w';
const ACTIVE = 'active';
const SCORED = 'scored';
const RESIGNED = 'resigned';

export function create({ players }) {
  if (players.length !== 2) throw new Error('Go requires exactly two players');
  return initialState(players.map((player) => player.id));
}

export function reduce({ state, playerId, action }) {
  const actorIndex = state.playerIds.indexOf(playerId);
  if (actorIndex < 0) return rejected('Unknown player');
  if (action === null || typeof action !== 'object' || typeof action.type !== 'string') {
    return rejected('Choose an action');
  }
  if (action.type === 'rematch') return voteForRematch(state, actorIndex);
  if (state.status !== ACTIVE) return rejected('The game is finished');
  if (action.type === 'resign') return resign(state, actorIndex);
  if (state.turn !== playerId) return rejected('Wait for your turn');
  if (action.type === 'pass') return pass(state, actorIndex);
  if (action.type !== 'place') return rejected('Unsupported action');
  if (!Number.isInteger(action.x) || !Number.isInteger(action.y)) {
    return rejected('Choose an intersection');
  }
  if (action.x < 0 || action.x >= BOARD_SIZE || action.y < 0 || action.y >= BOARD_SIZE) {
    return rejected('Intersection is outside the board');
  }
  return place(state, actorIndex, action.y * BOARD_SIZE + action.x);
}

export function view({ state, viewer, revision }) {
  const viewerIndex = state.playerIds.indexOf(viewer);
  const active = state.status === ACTIVE;
  return {
    board: state.board,
    viewer,
    viewerColor: viewerIndex === 0 ? BLACK : viewerIndex === 1 ? WHITE : null,
    turn: state.turn,
    turnColor: state.turn === null ? null : colorForIndex(state.playerIds.indexOf(state.turn)),
    status: state.status,
    winner: state.winner,
    winnerColor: state.winner === null ? null : colorForIndex(state.playerIds.indexOf(state.winner)),
    consecutivePasses: state.consecutivePasses,
    blackScoreHalfPoints: state.blackScoreHalfPoints,
    whiteScoreHalfPoints: state.whiteScoreHalfPoints,
    captures: [...state.captures],
    lastMove: state.lastMove,
    lastCaptureCount: state.lastCaptureCount,
    rematchVotes: [...state.rematchVotes],
    canPlay: active && state.turn === viewer,
    canPass: active && state.turn === viewer,
    canResign: active && viewerIndex >= 0,
    canRematch: !active && viewerIndex >= 0 && !state.rematchVotes[viewerIndex],
    revision,
  };
}

function initialState(playerIds) {
  return {
    playerIds: [...playerIds],
    board: EMPTY.repeat(CELL_COUNT),
    previousBoard: EMPTY.repeat(CELL_COUNT),
    turn: playerIds[0],
    status: ACTIVE,
    winner: null,
    consecutivePasses: 0,
    blackScoreHalfPoints: 0,
    whiteScoreHalfPoints: 0,
    captures: [0, 0],
    lastMove: null,
    lastCaptureCount: 0,
    rematchVotes: [false, false],
  };
}

function place(state, actorIndex, cell) {
  if (state.board[cell] !== EMPTY) return rejected('That intersection is occupied');
  const actor = colorForIndex(actorIndex);
  const opponent = actor === BLACK ? WHITE : BLACK;
  const board = [...state.board];
  board[cell] = actor;
  const captured = removeCapturedNeighbors(board, cell, opponent);
  if (!groupAt(board, cell).hasLiberty) return rejected('A stone cannot be played without a liberty');
  const candidate = board.join('');
  if (candidate === state.previousBoard) return rejected('Simple ko forbids an immediate recapture');

  const captures = [...state.captures];
  captures[actorIndex] += captured;
  const nextTurn = state.playerIds[actorIndex === 0 ? 1 : 0];
  return accepted({
    ...state,
    board: candidate,
    previousBoard: state.board,
    turn: nextTurn,
    consecutivePasses: 0,
    captures,
    lastMove: cell,
    lastCaptureCount: captured,
  }, [{
    type: captured === 0 ? 'stonePlaced' : 'stonesCaptured',
    playerId: state.playerIds[actorIndex],
    cell,
    count: captured,
  }]);
}

function pass(state, actorIndex) {
  const consecutivePasses = state.consecutivePasses + 1;
  if (consecutivePasses < 2) {
    return accepted({
      ...state,
      previousBoard: state.board,
      turn: state.playerIds[actorIndex === 0 ? 1 : 0],
      consecutivePasses,
      lastMove: null,
      lastCaptureCount: 0,
    }, [{ type: 'passed', playerId: state.playerIds[actorIndex] }]);
  }

  const scores = scoreBoard(state.board);
  const winnerIndex = scores.black > scores.white ? 0 : 1;
  return accepted({
    ...state,
    previousBoard: state.board,
    turn: null,
    status: SCORED,
    winner: state.playerIds[winnerIndex],
    consecutivePasses,
    blackScoreHalfPoints: scores.black,
    whiteScoreHalfPoints: scores.white,
    lastMove: null,
    lastCaptureCount: 0,
  }, [{
    type: 'gameScored',
    winner: state.playerIds[winnerIndex],
    blackScoreHalfPoints: scores.black,
    whiteScoreHalfPoints: scores.white,
  }]);
}

function resign(state, actorIndex) {
  const winner = state.playerIds[actorIndex === 0 ? 1 : 0];
  return accepted({
    ...state,
    turn: null,
    status: RESIGNED,
    winner,
    lastMove: null,
    lastCaptureCount: 0,
  }, [{ type: 'resigned', playerId: state.playerIds[actorIndex], winner }]);
}

function voteForRematch(state, actorIndex) {
  if (state.status === ACTIVE) return rejected('Finish the game before requesting a rematch');
  if (state.rematchVotes[actorIndex]) return rejected('Rematch already requested');
  const rematchVotes = [...state.rematchVotes];
  rematchVotes[actorIndex] = true;
  if (!rematchVotes.every(Boolean)) {
    return accepted({ ...state, rematchVotes }, [{
      type: 'rematchWaiting',
      playerId: state.playerIds[actorIndex],
    }]);
  }
  return accepted(initialState(state.playerIds), [{ type: 'rematchStarted' }]);
}

function removeCapturedNeighbors(board, placed, opponent) {
  let captured = 0;
  for (const neighbor of neighbors(placed)) {
    if (board[neighbor] !== opponent) continue;
    const group = groupAt(board, neighbor);
    if (group.hasLiberty) continue;
    for (const stone of group.stones) board[stone] = EMPTY;
    captured += group.stones.length;
  }
  return captured;
}

function groupAt(board, start) {
  const color = board[start];
  const stones = [start];
  const seen = new Set(stones);
  let hasLiberty = false;
  for (let cursor = 0; cursor < stones.length; cursor += 1) {
    for (const neighbor of neighbors(stones[cursor])) {
      if (board[neighbor] === EMPTY) {
        hasLiberty = true;
      } else if (board[neighbor] === color && !seen.has(neighbor)) {
        seen.add(neighbor);
        stones.push(neighbor);
      }
    }
  }
  return { stones, hasLiberty };
}

function scoreBoard(boardString) {
  const board = [...boardString];
  let blackPoints = 0;
  let whitePoints = 0;
  const seen = new Set();
  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    if (board[cell] === BLACK) {
      blackPoints += 1;
      continue;
    }
    if (board[cell] === WHITE) {
      whitePoints += 1;
      continue;
    }
    if (seen.has(cell)) continue;

    const region = [cell];
    seen.add(cell);
    let bordersBlack = false;
    let bordersWhite = false;
    for (let cursor = 0; cursor < region.length; cursor += 1) {
      for (const neighbor of neighbors(region[cursor])) {
        if (board[neighbor] === EMPTY && !seen.has(neighbor)) {
          seen.add(neighbor);
          region.push(neighbor);
        } else if (board[neighbor] === BLACK) {
          bordersBlack = true;
        } else if (board[neighbor] === WHITE) {
          bordersWhite = true;
        }
      }
    }
    if (bordersBlack && !bordersWhite) blackPoints += region.length;
    if (bordersWhite && !bordersBlack) whitePoints += region.length;
  }
  return {
    black: blackPoints * 2,
    white: whitePoints * 2 + KOMI_HALF_POINTS,
  };
}

function neighbors(cell) {
  const row = Math.floor(cell / BOARD_SIZE);
  const column = cell % BOARD_SIZE;
  const result = [];
  if (row > 0) result.push(cell - BOARD_SIZE);
  if (column > 0) result.push(cell - 1);
  if (column + 1 < BOARD_SIZE) result.push(cell + 1);
  if (row + 1 < BOARD_SIZE) result.push(cell + BOARD_SIZE);
  return result;
}

function colorForIndex(index) {
  if (index === 0) return BLACK;
  if (index === 1) return WHITE;
  return null;
}

function accepted(state, events = []) {
  return { accepted: true, state, events };
}

function rejected(reason) {
  return { accepted: false, reason };
}

function createPosition({
  playerIds = ['player-1', 'player-2'],
  stones = {},
  previousStones = null,
  turnIndex = 0,
  consecutivePasses = 0,
} = {}) {
  const board = Array(CELL_COUNT).fill(EMPTY);
  for (const [coordinate, color] of Object.entries(stones)) {
    const cell = coordinateToCell(coordinate);
    if (![BLACK, WHITE].includes(color)) throw new Error(`Invalid color at ${coordinate}`);
    board[cell] = color;
  }
  const state = initialState(playerIds);
  state.board = board.join('');
  state.previousBoard = previousStones === null
    ? state.board
    : createPosition({ playerIds, stones: previousStones }).board;
  state.turn = playerIds[turnIndex];
  state.consecutivePasses = consecutivePasses;
  return state;
}

function coordinateToCell(coordinate) {
  const match = /^([a-s])(1[0-9]|[1-9])$/.exec(coordinate);
  if (!match) throw new Error(`Invalid Go coordinate ${coordinate}`);
  return (Number(match[2]) - 1) * BOARD_SIZE + (match[1].charCodeAt(0) - 97);
}

export const __testing = Object.freeze({
  BLACK,
  WHITE,
  EMPTY,
  ACTIVE,
  SCORED,
  RESIGNED,
  createPosition,
  coordinateToCell,
  groupAt,
  scoreBoard,
});
