const EMPTY = 0;
const ONE_MAN = 1;
const ONE_KING = 2;
const TWO_MAN = 3;
const TWO_KING = 4;
const NO_FORCED_PIECE = 255;

export const scenarios = [
  {
    name: 'initial state matches the committed American checkers setup',
    players: 2,
    async run({ host, assert }) {
      const first = await host.viewForSeat(1);
      const second = await host.viewForSeat(2);
      assert.equal(first.turn, 'player-1');
      assert.equal(first.finished, false);
      assert.equal(first.forcedPiece, NO_FORCED_PIECE);
      assert.equal(first.noProgressMoves, 0);
      assert.equal(first.cells.filter((piece) => piece === ONE_MAN).length, 12);
      assert.equal(first.cells.filter((piece) => piece === TWO_MAN).length, 12);
      for (let cell = 0; cell < 64; cell += 1) {
        if (first.cells[cell] !== EMPTY) {
          assert.equal((Math.floor(cell / 8) + (cell % 8)) % 2, 1, `piece on light square ${cell}`);
        }
      }
      assert.equal(first.legalMoves.length, 7);
      assert.equal(second.legalMoves.length, 0);
    },
  },
  {
    name: 'mandatory capture rejects an otherwise legal simple move',
    players: 2,
    async run({ host, assert }) {
      setPosition(host, [[42, ONE_MAN], [44, ONE_MAN], [33, TWO_MAN], [1, TWO_MAN]]);
      const before = host.revision;
      const rejected = await host.dispatchAction(1, { type: 'move', from: 44, to: 35 });
      assert.equal(rejected.accepted, false);
      assert.match(rejected.reason, /capture/i);
      assert.equal(host.revision, before);
      const view = await host.viewForSeat(1);
      assert.deepEqual(view.legalMoves, [{ from: 42, to: 24, capture: true, captured: 33 }]);
      assert.equal((await host.dispatchAction(1, { type: 'move', from: 42, to: 24 })).accepted, true);
      assert.equal((await host.viewForSeat(2)).cells[33], EMPTY);
    },
  },
  {
    name: 'multi-jump keeps the turn and forces the capturing piece',
    players: 2,
    async run({ host, assert }) {
      setPosition(host, [[46, ONE_MAN], [42, ONE_MAN], [37, TWO_MAN], [19, TWO_MAN], [1, TWO_MAN]]);
      assert.equal((await host.dispatchAction(1, { type: 'move', from: 46, to: 28 })).accepted, true);
      const chained = await host.viewForSeat(1);
      assert.equal(chained.turn, 'player-1');
      assert.equal(chained.forcedPiece, 28);
      assert.deepEqual(chained.legalMoves, [{ from: 28, to: 10, capture: true, captured: 19 }]);
      const otherPiece = await host.dispatchAction(1, { type: 'move', from: 42, to: 33 });
      assert.equal(otherPiece.accepted, false);
      assert.equal(otherPiece.revision, 1);
      assert.equal((await host.dispatchAction(1, { type: 'move', from: 28, to: 10 })).accepted, true);
      const completed = await host.viewForSeat(2);
      assert.equal(completed.turn, 'player-2');
      assert.equal(completed.forcedPiece, NO_FORCED_PIECE);
      assert.equal(completed.cells[37], EMPTY);
      assert.equal(completed.cells[19], EMPTY);
    },
  },
  {
    name: 'kings can move backward',
    players: 2,
    async run({ host, assert }) {
      setPosition(host, [[35, ONE_KING], [1, TWO_MAN]]);
      const result = await host.dispatchAction(1, { type: 'move', from: 35, to: 44 });
      assert.equal(result.accepted, true);
      const view = await host.viewForSeat(2);
      assert.equal(view.cells[35], EMPTY);
      assert.equal(view.cells[44], ONE_KING);
      assert.equal(view.noProgressMoves, 1);
    },
  },
  {
    name: 'promotion ends an otherwise available capture sequence',
    players: 2,
    async run({ host, assert }) {
      setPosition(host, [[17, ONE_MAN], [10, TWO_MAN], [12, TWO_MAN]]);
      const result = await host.dispatchAction(1, { type: 'move', from: 17, to: 3 });
      assert.equal(result.accepted, true);
      const view = await host.viewForSeat(1);
      assert.equal(view.cells[3], ONE_KING);
      assert.equal(view.cells[10], EMPTY);
      assert.equal(view.cells[12], TWO_MAN);
      assert.equal(view.turn, 'player-2');
      assert.equal(view.forcedPiece, NO_FORCED_PIECE);
      assert.equal(view.noProgressMoves, 0);
    },
  },
  {
    name: 'a player blocked after a completed move loses',
    players: 2,
    async run({ host, assert }) {
      setPosition(host, [[42, ONE_MAN], [56, TWO_MAN]]);
      assert.equal((await host.dispatchAction(1, { type: 'move', from: 42, to: 33 })).accepted, true);
      const view = await host.viewForSeat(2);
      assert.equal(view.finished, true);
      assert.equal(view.winner, 'player-1');
      assert.equal(view.draw, false);
      assert.equal(view.turn, null);
    },
  },
  {
    name: 'eighty completed moves without progress produces a draw',
    players: 2,
    async run({ host, assert }) {
      setPosition(host, [[42, ONE_KING], [21, TWO_KING]], { noProgressMoves: 79 });
      assert.equal((await host.dispatchAction(1, { type: 'move', from: 42, to: 33 })).accepted, true);
      const view = await host.viewForSeat(1);
      assert.equal(view.noProgressMoves, 80);
      assert.equal(view.finished, true);
      assert.equal(view.draw, true);
      assert.equal(view.winner, null);
      assert.equal(view.turn, null);
    },
  },
  {
    name: 'surrender and two rematch votes restore the opening board',
    players: 2,
    async run({ host, assert }) {
      const surrender = await host.dispatchAction(1, { type: 'surrender' });
      assert.equal(surrender.accepted, true);
      assert.equal((await host.viewForSeat(2)).winner, 'player-2');
      const firstVote = await host.dispatchAction(1, { type: 'rematch' });
      assert.equal(firstVote.accepted, true);
      assert.deepEqual((await host.viewForSeat(2)).rematchVotes, [true, false]);
      const duplicate = await host.dispatchAction(1, { type: 'rematch' });
      assert.equal(duplicate.accepted, false);
      assert.equal(duplicate.revision, firstVote.revision);
      assert.equal((await host.dispatchAction(2, { type: 'rematch' })).accepted, true);
      const reset = await host.viewForSeat(1);
      assert.equal(reset.turn, 'player-1');
      assert.equal(reset.winner, null);
      assert.equal(reset.finished, false);
      assert.equal(reset.noProgressMoves, 0);
      assert.equal(reset.cells.filter((piece) => piece === ONE_MAN).length, 12);
      assert.equal(reset.cells.filter((piece) => piece === TWO_MAN).length, 12);
      assert.deepEqual(reset.rematchVotes, [false, false]);
    },
  },
  {
    name: 'illegal and malformed moves preserve state and revision',
    players: 2,
    async run({ host, assert }) {
      const before = host.stateSnapshot();
      const actions = [
        [2, { type: 'move', from: 17, to: 24 }],
        [1, { type: 'move', from: 40, to: 49 }],
        [1, { type: 'move', from: 40, to: 40 }],
        [1, { type: 'move', from: 32, to: 25 }],
        [1, { type: 'move', from: -1, to: 8 }],
        [1, { type: 'move', from: 40, to: 34 }],
        [1, { type: 'move', from: '40', to: 33 }],
        [1, { type: 'dance' }],
      ];
      for (const [seat, action] of actions) {
        const result = await host.dispatchAction(seat, action);
        assert.equal(result.accepted, false, JSON.stringify(action));
        assert.equal(result.revision, 0);
      }
      assert.deepEqual(host.stateSnapshot(), before);
    },
  },
  {
    name: 'per-seat views expose only that seats legal controls and isolate copies',
    players: 2,
    async run({ host, assert }) {
      const first = await host.viewForSeat(1);
      const second = await host.viewForSeat(2);
      assert.equal(first.viewer, 'player-1');
      assert.equal(first.mySide, 1);
      assert.equal(second.viewer, 'player-2');
      assert.equal(second.mySide, 2);
      assert.equal(first.legalMoves.length, 7);
      assert.equal(second.legalMoves.length, 0);
      assert.deepEqual(first.cells, second.cells);
      first.cells[0] = 99;
      first.legalMoves[0].to = 99;
      const unmodified = await host.viewForSeat(1);
      assert.equal(unmodified.cells[0], EMPTY);
      assert.notEqual(unmodified.legalMoves[0].to, 99);
      assert.equal((await host.dispatchAction(1, { type: 'move', from: 40, to: 33 })).accepted, true);
      assert.equal((await host.viewForSeat(1)).legalMoves.length, 0);
      assert.ok((await host.viewForSeat(2)).legalMoves.length > 0);
    },
  },
  {
    name: 'committed authority regression reaches the same chained captures and promotion',
    players: 2,
    async run({ host, assert }) {
      const moves = [
        [1, 46, 39], [2, 19, 28], [1, 53, 46], [2, 10, 19],
        [1, 44, 35], [2, 28, 37], [1, 46, 28], [1, 28, 10],
        [2, 1, 19], [1, 51, 44], [2, 19, 26], [1, 60, 53],
        [2, 12, 19], [1, 44, 37], [2, 26, 44], [1, 53, 35],
        [2, 23, 30], [1, 37, 23], [2, 21, 30], [1, 39, 21],
        [2, 14, 28], [1, 35, 21], [2, 3, 12], [1, 21, 3],
      ];
      for (let index = 0; index < moves.length; index += 1) {
        if (index === 6) {
          const mandatory = await host.dispatchAction(1, { type: 'move', from: 42, to: 33 });
          assert.equal(mandatory.accepted, false);
        }
        const [seat, from, to] = moves[index];
        const result = await host.dispatchAction(seat, { type: 'move', from, to });
        assert.equal(result.accepted, true, `move ${index + 1}: ${from} -> ${to}: ${result.reason ?? 'rejected'}`);
        if (index === 6) {
          const chained = await host.viewForSeat(1);
          assert.equal(chained.turn, 'player-1');
          assert.equal(chained.forcedPiece, 28);
          const wrongPiece = await host.dispatchAction(1, { type: 'move', from: 39, to: 21 });
          assert.equal(wrongPiece.accepted, false);
        }
        if (index === 7) {
          const completed = await host.viewForSeat(1);
          assert.equal(completed.turn, 'player-2');
          assert.equal(completed.forcedPiece, NO_FORCED_PIECE);
        }
      }
      const final = await host.viewForSeat(2);
      assert.equal(final.cells[3], ONE_KING);
    },
  },
];

function setPosition(host, pieces, overrides = {}) {
  const current = host.stateSnapshot();
  const cells = Array(64).fill(EMPTY);
  for (const [cell, piece] of pieces) cells[cell] = piece;
  host.state = {
    ...current,
    cells,
    turn: current.playerIds[0],
    winner: null,
    draw: false,
    finished: false,
    forcedPiece: NO_FORCED_PIECE,
    noProgressMoves: 0,
    rematchVotes: [false, false],
    ...overrides,
  };
}
