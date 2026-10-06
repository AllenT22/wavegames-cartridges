import {
  BOARD_SIZE,
  CELL_COUNT,
  KOMI_HALF_POINTS,
  __testing,
  reduce,
  view,
} from '../rules/index.mjs';

const { BLACK, WHITE } = __testing;

export const scenarios = [
  {
    name: 'a full 19 by 19 board starts with Black and public per-seat views',
    players: 2,
    async run({ host, assert }) {
      const first = await host.viewForSeat(1);
      const second = await host.viewForSeat(2);
      assert.equal(first.board, '.'.repeat(CELL_COUNT));
      assert.equal(first.board.length, BOARD_SIZE * BOARD_SIZE);
      assert.equal(first.turn, 'player-1');
      assert.equal(first.viewerColor, BLACK);
      assert.equal(second.viewerColor, WHITE);
      assert.equal(first.canPlay, true);
      assert.equal(second.canPlay, false);
      assert.equal(first.board, second.board);
      first.captures[0] = 99;
      assert.deepEqual((await host.viewForSeat(2)).captures, [0, 0]);
    },
  },
  {
    name: 'captures remove surrounded stones and reset consecutive passes',
    players: 2,
    async run({ host, assert }) {
      await play(host, [
        [1, 0, 1], [2, 1, 1], [1, 1, 0], [2, 10, 10],
        [1, 2, 1], [2, 11, 10], [1, 1, 2],
      ], assert);
      const current = await host.viewForSeat(1);
      assert.equal(current.board[cell(1, 1)], '.');
      assert.equal(current.board[cell(1, 2)], BLACK);
      assert.deepEqual(current.captures, [1, 0]);
      assert.equal(current.lastCaptureCount, 1);
      assert.equal(current.consecutivePasses, 0);
    },
  },
  {
    name: 'suicide and occupied or out-of-range placements reject without revision',
    players: 2,
    async run({ host, assert }) {
      await play(host, [
        [1, 0, 1], [2, 1, 1], [1, 1, 0], [2, 10, 10],
        [1, 2, 1], [2, 11, 10], [1, 1, 2],
      ], assert);
      const before = host.revision;
      for (const action of [
        { type: 'place', x: 1, y: 1 },
        { type: 'place', x: 1, y: 2 },
        { type: 'place', x: -1, y: 0 },
        { type: 'place', x: 19, y: 0 },
      ]) {
        const result = await host.dispatchAction(2, action);
        assert.equal(result.accepted, false);
        assert.equal(result.revision, before);
      }
      assert.equal(host.revision, before);
    },
  },
  {
    name: 'simple ko forbids immediate recapture but permits it after intervening play',
    players: 2,
    async run({ host, assert }) {
      await play(host, [
        [1, 0, 1], [2, 1, 1], [1, 1, 0], [2, 0, 2],
        [1, 2, 1], [2, 2, 2], [1, 10, 10], [2, 1, 3], [1, 1, 2],
      ], assert);
      const revision = host.revision;
      const ko = await host.dispatchAction(2, { type: 'place', x: 1, y: 1 });
      assert.equal(ko.accepted, false);
      assert.match(ko.reason, /ko/i);
      assert.equal(host.revision, revision);
      await play(host, [[2, 11, 10], [1, 12, 10], [2, 1, 1]], assert);
      const current = await host.viewForSeat(2);
      assert.equal(current.board[cell(1, 1)], WHITE);
      assert.equal(current.board[cell(1, 2)], '.');
    },
  },
  {
    name: 'a pass hands over the turn and any placement clears the pass count',
    players: 2,
    async run({ host, assert }) {
      const passed = await host.dispatchAction(1, { type: 'pass' });
      assert.equal(passed.accepted, true);
      assert.equal((await host.viewForSeat(2)).consecutivePasses, 1);
      const placed = await host.dispatchAction(2, { type: 'place', x: 3, y: 3 });
      assert.equal(placed.accepted, true);
      const current = await host.viewForSeat(1);
      assert.equal(current.consecutivePasses, 0);
      assert.equal(current.lastMove, cell(3, 3));
    },
  },
  {
    name: 'two passes apply Chinese-area scoring with six and a half komi',
    players: 2,
    async run({ host, assert }) {
      await host.dispatchAction(1, { type: 'pass' });
      const result = await host.dispatchAction(2, { type: 'pass' });
      assert.equal(result.accepted, true);
      const finished = await host.viewForSeat(1);
      assert.equal(finished.status, 'scored');
      assert.equal(finished.winner, 'player-2');
      assert.equal(finished.blackScoreHalfPoints, 0);
      assert.equal(finished.whiteScoreHalfPoints, KOMI_HALF_POINTS);
      assert.equal(finished.consecutivePasses, 2);
      assert.equal(finished.canPlay, false);
    },
  },
  {
    name: 'area scoring counts stones and territory and leaves shared regions neutral',
    players: 2,
    run({ assert }) {
      const allBlack = BLACK.repeat(CELL_COUNT - 1) + WHITE;
      assert.deepEqual(__testing.scoreBoard(allBlack), {
        black: (CELL_COUNT - 1) * 2,
        white: 2 + KOMI_HALF_POINTS,
      });
      const shared = __testing.createPosition({ stones: { a1: BLACK, s19: WHITE } });
      assert.deepEqual(__testing.scoreBoard(shared.board), {
        black: 2,
        white: 2 + KOMI_HALF_POINTS,
      });
    },
  },
  {
    name: 'resignation and unanimous rematch restore the same seating and colors',
    players: 2,
    async run({ host, assert }) {
      const resigned = await host.dispatchAction(1, { type: 'resign' });
      assert.equal(resigned.accepted, true);
      assert.equal((await host.viewForSeat(2)).winner, 'player-2');
      const firstVote = await host.dispatchAction(1, { type: 'rematch' });
      assert.equal(firstVote.accepted, true);
      const duplicate = await host.dispatchAction(1, { type: 'rematch' });
      assert.equal(duplicate.accepted, false);
      assert.equal(duplicate.revision, firstVote.revision);
      const secondVote = await host.dispatchAction(2, { type: 'rematch' });
      assert.equal(secondVote.accepted, true);
      const reset = await host.viewForSeat(1);
      assert.equal(reset.status, 'active');
      assert.equal(reset.turn, 'player-1');
      assert.equal(reset.viewerColor, BLACK);
      assert.equal(reset.board, '.'.repeat(CELL_COUNT));
      assert.deepEqual(reset.rematchVotes, [false, false]);
    },
  },
  {
    name: 'malformed and out-of-turn actions preserve authority state',
    players: 2,
    async run({ host, assert }) {
      const before = host.stateSnapshot();
      for (const [seat, action] of [
        [2, { type: 'place', x: 3, y: 3 }],
        [1, { type: 'place', x: 3.5, y: 3 }],
        [1, { type: 'place', x: 3 }],
        [1, { type: 'dance' }],
      ]) {
        assert.equal((await host.dispatchAction(seat, action)).accepted, false);
      }
      assert.deepEqual(host.stateSnapshot(), before);
      assert.equal(host.revision, 0);
    },
  },
  {
    name: 'capture opens a liberty and one connected group touching twice is counted once',
    players: 2,
    run({ assert }) {
      const state = __testing.createPosition({ stones: {
        a1: WHITE, b1: WHITE, a2: WHITE,
        c1: BLACK, c2: BLACK, b3: BLACK, a3: BLACK,
      } });
      const before = structuredClone(state);
      const result = reduce({ state, playerId: 'player-1', action: { type: 'place', x: 1, y: 1 } });
      assert.equal(result.accepted, true);
      assert.deepEqual(result.state.captures, [3, 0]);
      for (const coordinate of ['a1', 'b1', 'a2']) assert.equal(result.state.board[__testing.coordinateToCell(coordinate)], '.');
      assert.deepEqual(state, before);
    },
  },
  {
    name: 'board edges do not wrap into the next row',
    players: 2,
    run({ assert }) {
      const state = __testing.createPosition({ stones: { s1: WHITE, r1: BLACK, s2: BLACK } });
      const result = reduce({ state, playerId: 'player-1', action: { type: 'place', x: 0, y: 1 } });
      assert.equal(result.accepted, true);
      assert.equal(result.state.board[18], WHITE);
      assert.equal(result.state.lastCaptureCount, 0);
    },
  },
  {
    name: 'enclosed empty regions count for their border color without capture bonuses',
    players: 2,
    run({ assert }) {
      const state = __testing.createPosition({ stones: {
        c4: BLACK, d3: BLACK, d5: BLACK, e4: BLACK,
        o16: WHITE, p15: WHITE, p17: WHITE, q16: WHITE,
      } });
      state.captures = [80, 90];
      const firstPass = reduce({ state, playerId: 'player-1', action: { type: 'pass' } });
      const secondPass = reduce({ state: firstPass.state, playerId: 'player-2', action: { type: 'pass' } });
      assert.equal(secondPass.state.blackScoreHalfPoints, 10);
      assert.equal(secondPass.state.whiteScoreHalfPoints, 10 + KOMI_HALF_POINTS);
    },
  },
  {
    name: 'a pass lifts simple ko without permitting an out-of-turn recapture',
    players: 2,
    run({ assert }) {
      const prior = { a2: BLACK, b1: BLACK, c2: BLACK, b2: WHITE, a3: WHITE, c3: WHITE, b4: WHITE };
      const state = __testing.createPosition({ stones: prior });
      const capture = reduce({ state, playerId: 'player-1', action: { type: 'place', x: 1, y: 2 } });
      assert.equal(capture.accepted, true);
      assert.equal(reduce({ state: capture.state, playerId: 'player-2', action: { type: 'place', x: 1, y: 1 } }).accepted, false);
      const pass = reduce({ state: capture.state, playerId: 'player-2', action: { type: 'pass' } });
      assert.equal(reduce({ state: pass.state, playerId: 'player-2', action: { type: 'place', x: 1, y: 1 } }).accepted, false);
      const elsewhere = reduce({ state: pass.state, playerId: 'player-1', action: { type: 'place', x: 18, y: 18 } });
      assert.equal(reduce({ state: elsewhere.state, playerId: 'player-2', action: { type: 'place', x: 1, y: 1 } }).accepted, true);
    },
  },
  {
    name: 'unknown players and malformed actions cannot mutate state, and finished games accept only rematch votes',
    players: 2,
    run({ assert }) {
      const state = __testing.createPosition();
      const before = structuredClone(state);
      for (const action of [null, undefined, [], { type: 'place', x: NaN, y: 0 }, { type: 'place', x: 0, y: Infinity }]) {
        assert.equal(reduce({ state, playerId: 'player-1', action }).accepted, false);
      }
      assert.equal(reduce({ state, playerId: 'outsider', action: { type: 'resign' } }).accepted, false);
      assert.equal(view({ state, viewer: 'outsider', revision: 0 }).canResign, false);
      assert.equal(reduce({ state, playerId: 'player-1', action: { type: 'rematch' } }).accepted, false);
      assert.deepEqual(state, before);
      const finished = reduce({ state, playerId: 'player-2', action: { type: 'resign' } });
      assert.equal(finished.accepted, true, 'A player may resign while waiting for their turn');
      assert.equal(finished.state.winner, 'player-1');
      for (const type of ['pass', 'place', 'resign']) {
        assert.equal(reduce({ state: finished.state, playerId: 'player-1', action: { type, x: 0, y: 0 } }).accepted, false);
      }
    },
  },
  {
    name: 'direct rules parity exposes safe controls and immutable public state',
    players: 2,
    run({ assert }) {
      const state = __testing.createPosition({ stones: { d4: BLACK, q16: WHITE } });
      const first = view({ state, viewer: 'player-1', revision: 4 });
      const second = view({ state, viewer: 'player-2', revision: 4 });
      assert.equal(first.board, second.board);
      assert.equal(first.canPlay, true);
      assert.equal(second.canPlay, false);
      const result = reduce({
        state,
        playerId: 'player-1',
        action: { type: 'place', x: 4, y: 3 },
      });
      assert.equal(result.accepted, true);
      assert.equal(state.board[cell(4, 3)], '.');
      assert.equal(result.state.board[cell(4, 3)], BLACK);
    },
  },
];

async function play(host, moves, assert) {
  for (const [seat, x, y] of moves) {
    const result = await host.dispatchAction(seat, { type: 'place', x, y });
    assert.equal(result.accepted, true, `seat ${seat}, ${x},${y}: ${result.reason ?? 'rejected'}`);
  }
}

function cell(x, y) {
  return y * BOARD_SIZE + x;
}
