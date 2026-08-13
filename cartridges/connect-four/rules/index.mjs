const columns = 7;
const rows = 6;

export function create({ players }) {
  if (players.length !== 2) throw new Error('Connect Four requires exactly two players');
  return {
    cells: Array(columns * rows).fill(0),
    playerIds: players.map((player) => player.id),
    turn: players[0].id,
    winner: null,
    draw: false,
    moves: 0,
    winningCells: [],
    rematchVotes: [false, false],
  };
}

export function reduce({ state, playerId, action }) {
  const actorIndex = state.playerIds.indexOf(playerId);
  if (actorIndex < 0) return rejected('Unknown player');
  if (action === null || typeof action !== 'object' || typeof action.type !== 'string') {
    return rejected('Choose an action');
  }
  if (action.type === 'rematch') return voteForRematch(state, actorIndex);
  if (state.winner !== null || state.draw) return rejected('The game is finished');
  if (action.type === 'surrender') {
    const winner = state.playerIds[actorIndex === 0 ? 1 : 0];
    return {
      accepted: true,
      state: { ...state, winner, winningCells: [] },
      events: [{ type: 'surrendered', actor: actorIndex + 1 }],
    };
  }
  if (playerId !== state.turn) return rejected('Wait for your turn');
  if (action.type !== 'drop' || !Number.isInteger(action.column)) return rejected('Choose a column');
  if (action.column < 0 || action.column >= columns) return rejected('Column is outside the board');
  const row = landingRow(state.cells, action.column);
  if (row < 0) return rejected('That column is full');

  const actor = actorIndex + 1;
  const cells = [...state.cells];
  const cell = row * columns + action.column;
  cells[cell] = actor;
  const winningCells = winningLine(cells, cell, actor);
  const moves = state.moves + 1;
  const winner = winningCells.length === 4 ? playerId : null;
  const draw = winner === null && moves === cells.length;
  const turn = winner !== null || draw
    ? state.turn
    : state.playerIds[actorIndex === 0 ? 1 : 0];
  return {
    accepted: true,
    state: {
      ...state,
      cells,
      turn,
      winner,
      draw,
      moves,
      winningCells,
    },
    events: [{ type: winner === null ? 'discDropped' : 'victory', actor, column: action.column }],
  };
}

export function view({ state, viewer, revision }) {
  return {
    cells: [...state.cells],
    turn: state.turn,
    winner: state.winner,
    draw: state.draw,
    moves: state.moves,
    winningCells: [...state.winningCells],
    rematchVotes: [...state.rematchVotes],
    viewer,
    myDisc: state.playerIds.indexOf(viewer) + 1,
    canDrop: Array.from({ length: columns }, (_, column) =>
      state.winner === null && !state.draw && state.turn === viewer && state.cells[column] === 0
    ),
    revision,
  };
}

function voteForRematch(state, actorIndex) {
  if (state.winner === null && !state.draw) return rejected('Finish the game before requesting a rematch');
  if (state.rematchVotes[actorIndex]) return rejected('Rematch already requested');
  const rematchVotes = [...state.rematchVotes];
  rematchVotes[actorIndex] = true;
  if (!rematchVotes.every(Boolean)) {
    return {
      accepted: true,
      state: { ...state, rematchVotes },
      events: [{ type: 'rematchWaiting', actor: actorIndex + 1 }],
    };
  }
  const playerIds = [state.playerIds[1], state.playerIds[0]];
  return {
    accepted: true,
    state: {
      cells: Array(columns * rows).fill(0),
      playerIds,
      turn: playerIds[0],
      winner: null,
      draw: false,
      moves: 0,
      winningCells: [],
      rematchVotes: [false, false],
    },
    events: [{ type: 'rematchStarted' }],
  };
}

function rejected(reason) {
  return { accepted: false, reason };
}

function landingRow(cells, column) {
  for (let row = rows - 1; row >= 0; row -= 1) {
    if (cells[row * columns + column] === 0) return row;
  }
  return -1;
}

function winningLine(cells, origin, actor) {
  const originRow = Math.floor(origin / columns);
  const originColumn = origin % columns;
  for (const [rowStep, columnStep] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [origin];
    collect(line, cells, actor, originRow, originColumn, rowStep, columnStep);
    collect(line, cells, actor, originRow, originColumn, -rowStep, -columnStep);
    line.sort((left, right) => left - right);
    if (line.length >= 4) return fourIncludingOrigin(line, origin, rowStep, columnStep);
  }
  return [];
}

function collect(line, cells, actor, row, column, rowStep, columnStep) {
  for (let distance = 1; distance < 4; distance += 1) {
    const nextRow = row + rowStep * distance;
    const nextColumn = column + columnStep * distance;
    if (nextRow < 0 || nextRow >= rows || nextColumn < 0 || nextColumn >= columns) return;
    const cell = nextRow * columns + nextColumn;
    if (cells[cell] !== actor) return;
    line.push(cell);
  }
}

function fourIncludingOrigin(line, origin, rowStep, columnStep) {
  const ordered = [...line].sort((left, right) => {
    const leftRow = Math.floor(left / columns);
    const rightRow = Math.floor(right / columns);
    const leftColumn = left % columns;
    const rightColumn = right % columns;
    return (leftRow * rowStep + leftColumn * columnStep) - (rightRow * rowStep + rightColumn * columnStep);
  });
  const originIndex = ordered.indexOf(origin);
  const start = Math.max(0, Math.min(originIndex, ordered.length - 4));
  return ordered.slice(start, start + 4).sort((left, right) => left - right);
}
