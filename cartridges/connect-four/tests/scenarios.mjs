export const scenarios = [
  {
    name: 'horizontal victory and turn enforcement',
    players: 2,
    async run({ host, assert }) {
      const rejected = await host.dispatchAction(2, { type: 'drop', column: 0 });
      assert.equal(rejected.accepted, false);
      for (const [seat, column] of [[1, 0], [2, 0], [1, 1], [2, 1], [1, 2], [2, 2], [1, 3]]) {
        const result = await host.dispatchAction(seat, { type: 'drop', column });
        assert.equal(result.accepted, true);
      }
      const first = await host.viewForSeat(1);
      const second = await host.viewForSeat(2);
      assert.equal(first.winner, 'player-1');
      assert.deepEqual(first.winningCells, [35, 36, 37, 38]);
      assert.deepEqual(first.cells, second.cells);
      assert.equal(first.revision, 7);
    },
  },
  {
    name: 'vertical victory',
    players: 2,
    async run({ host, assert }) {
      await play(host, [[1, 0], [2, 1], [1, 0], [2, 1], [1, 0], [2, 1], [1, 0]], assert);
      const view = await host.viewForSeat(1);
      assert.equal(view.winner, 'player-1');
      assert.deepEqual(view.winningCells, [14, 21, 28, 35]);
    },
  },
  {
    name: 'descending diagonal victory',
    players: 2,
    async run({ host, assert }) {
      await play(host, [
        [1, 0], [2, 1], [1, 1], [2, 2], [1, 6], [2, 2],
        [1, 2], [2, 3], [1, 6], [2, 3], [1, 5], [2, 3], [1, 3],
      ], assert);
      const view = await host.viewForSeat(1);
      assert.equal(view.winner, 'player-1');
      assert.deepEqual(view.winningCells, [17, 23, 29, 35]);
    },
  },
  {
    name: 'ascending diagonal victory',
    players: 2,
    async run({ host, assert }) {
      await play(host, [
        [1, 3], [2, 2], [1, 2], [2, 1], [1, 6], [2, 1],
        [1, 1], [2, 0], [1, 6], [2, 0], [1, 5], [2, 0], [1, 0],
      ], assert);
      const view = await host.viewForSeat(1);
      assert.equal(view.winner, 'player-1');
      assert.deepEqual(view.winningCells, [14, 22, 30, 38]);
    },
  },
  {
    name: 'full column rejects without revision',
    players: 2,
    async run({ host, assert }) {
      await play(host, [[1, 0], [2, 0], [1, 0], [2, 0], [1, 0], [2, 0]], assert);
      const before = host.revision;
      const result = await host.dispatchAction(1, { type: 'drop', column: 0 });
      assert.equal(result.accepted, false);
      assert.equal(result.revision, before);
      assert.equal(host.revision, before);
      assert.equal((await host.viewForSeat(1)).moves, 6);
    },
  },
  {
    name: 'draw fills the board without a winning line',
    players: 2,
    async run({ host, assert }) {
      const columns = [
        0, 3, 2, 0, 1, 3, 2, 1, 2, 3, 1, 2, 2, 5,
        3, 4, 3, 1, 6, 5, 3, 1, 1, 2, 4, 6, 5, 6,
        5, 4, 0, 4, 0, 0, 6, 4, 5, 5, 0, 6, 4, 6,
      ];
      await play(host, columns.map((column, index) => [(index % 2) + 1, column]), assert);
      const view = await host.viewForSeat(1);
      assert.equal(view.moves, 42);
      assert.equal(view.draw, true);
      assert.equal(view.winner, null);
    },
  },
  {
    name: 'surrender and two rematch votes reset with swapped opener',
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
      const secondVote = await host.dispatchAction(2, { type: 'rematch' });
      assert.equal(secondVote.accepted, true);
      const reset = await host.viewForSeat(1);
      assert.equal(reset.turn, 'player-2');
      assert.equal(reset.winner, null);
      assert.equal(reset.moves, 0);
      assert.deepEqual(reset.cells, Array(42).fill(0));
      assert.deepEqual(reset.rematchVotes, [false, false]);
    },
  },
  {
    name: 'per-seat views identify each player and isolate mutable copies',
    players: 2,
    async run({ host, assert }) {
      const first = await host.viewForSeat(1);
      const second = await host.viewForSeat(2);
      assert.equal(first.viewer, 'player-1');
      assert.equal(first.myDisc, 1);
      assert.equal(second.viewer, 'player-2');
      assert.equal(second.myDisc, 2);
      assert.deepEqual(first.cells, second.cells);
      first.cells[0] = 99;
      assert.equal((await host.viewForSeat(2)).cells[0], 0);
    },
  },
];

async function play(host, moves, assert) {
  for (const [seat, column] of moves) {
    const result = await host.dispatchAction(seat, { type: 'drop', column });
    assert.equal(result.accepted, true, `seat ${seat}, column ${column}: ${result.reason ?? 'rejected'}`);
  }
}
