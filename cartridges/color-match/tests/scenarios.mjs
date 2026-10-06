import {
  CARD_TYPES,
  COLORS,
  DECK_CARDS,
  PHASES,
  RANKS,
  WILD,
  WILD_DRAW_FOUR,
  cardColor,
  createControlledState,
  createColorMatch,
  handScore,
  handSize,
  playerTimedOutColorMatch,
  reduceColorMatch,
  seededRandom,
  viewColorMatch,
} from '../rules/color-match-engine.mjs';

export const scenarios = [
  {
    name: 'standard 108-card deck and deterministic deal for two through eight',
    players: 2,
    run({ assert }) {
      for (let playerCount = 2; playerCount <= 8; playerCount += 1) {
        const players = makePlayers(playerCount);
        const state = createColorMatch({ seed: 0x12340000 + playerCount, players });
        assert.equal(state.playerIds.length, playerCount);
        assert.equal(state.roundNumber, 1);
        assert.equal(state.dealer, `player-${playerCount}`);
        assert.notEqual(state.discardPile.at(-1), WILD_DRAW_FOUR);
        const copies = Array(CARD_TYPES).fill(0);
        let handTotal = 0;
        for (let actor = 0; actor < playerCount; actor += 1) {
          const cards = state.hands[actor].reduce((total, count) => total + count, 0);
          assert.ok(cards >= 7 && cards <= 9);
          handTotal += cards;
          state.hands[actor].forEach((count, card) => { copies[card] += count; });
        }
        state.drawPile.forEach((card) => { copies[card] += 1; });
        state.discardPile.forEach((card) => { copies[card] += 1; });
        assert.equal(state.drawPile.length + state.discardPile.length + handTotal, DECK_CARDS);
        for (let color = COLORS.RED; color <= COLORS.BLUE; color += 1) {
          assert.equal(copies[color * 13], 1);
          for (let rank = RANKS.ONE; rank <= RANKS.DRAW_TWO; rank += 1) {
            assert.equal(copies[color * 13 + rank], 2);
          }
        }
        assert.equal(copies[WILD], 4);
        assert.equal(copies[WILD_DRAW_FOUR], 4);
      }
    },
  },
  {
    name: 'fixed seed deal matches the API 1 golden vector',
    players: 4,
    seed: 0x57415645,
    run({ host, assert }) {
      const state = host.stateSnapshot();
      assert.deepEqual({
        top: state.discardPile.at(-1),
        color: state.currentColor,
        turn: state.currentTurn,
        dealer: state.dealer,
        direction: state.direction,
        drawCount: state.drawPile.length,
        hands: expandedHands(state),
      }, {
        top: 2,
        color: COLORS.RED,
        turn: 'player-1',
        dealer: 'player-4',
        direction: 0,
        drawCount: 79,
        hands: [
          [0, 6, 20, 25, 36, 47, 52],
          [10, 13, 19, 35, 38, 49, 50],
          [1, 8, 17, 22, 23, 30, 33],
          [15, 18, 24, 27, 28, 37, 46],
        ],
      });
    },
  },
  {
    name: 'two-player skip and reverse return the turn to their player',
    players: 2,
    run({ assert }) {
      for (const rank of [RANKS.SKIP, RANKS.REVERSE]) {
        const state = createControlledState();
        state.hands[0][rank] = 1;
        state.hands[0][1] = 1;
        const played = apply(state, 'player-1', { type: 'play', card: rank }, assert);
        assert.equal(played.currentTurn, 'player-1');
        assert.equal(played.phase, PHASES.ACTIVE);
      }
    },
  },
  {
    name: 'three-player reverse changes direction and action cards skip correctly',
    players: 3,
    run({ assert }) {
      const reversed = createControlledState(3);
      reversed.hands[0][RANKS.REVERSE] = 1;
      reversed.hands[0][1] = 1;
      const afterReverse = apply(
        reversed,
        'player-1',
        { type: 'play', card: RANKS.REVERSE },
        assert,
      );
      assert.equal(afterReverse.direction, 1);
      assert.equal(afterReverse.currentTurn, 'player-3');

      const skipped = createControlledState(3);
      skipped.hands[0][RANKS.SKIP] = 1;
      skipped.hands[0][1] = 1;
      assert.equal(
        apply(skipped, 'player-1', { type: 'play', card: RANKS.SKIP }, assert).currentTurn,
        'player-3',
      );

      const drawTwo = createControlledState(3);
      drawTwo.hands[0][RANKS.DRAW_TWO] = 1;
      drawTwo.hands[0][1] = 1;
      const before = handSize(drawTwo, 'player-2');
      const afterDrawTwo = apply(
        drawTwo,
        'player-1',
        { type: 'play', card: RANKS.DRAW_TWO },
        assert,
      );
      assert.equal(handSize(afterDrawTwo, 'player-2'), before + 2);
      assert.equal(afterDrawTwo.currentTurn, 'player-3');
    },
  },
  {
    name: 'a playable drawn card is the only card that may then be played',
    players: 2,
    run({ assert }) {
      let state = createControlledState();
      state.hands[0][1] = 1;
      state.hands[0][40] = 1;
      state.drawPile = [31];
      state = apply(state, 'player-1', { type: 'draw' }, assert);
      assert.equal(state.drawnPlayerId, 'player-1');
      assert.equal(state.drawnCard, 31);
      mustReject(state, 'player-1', { type: 'play', card: 1 }, assert);
      state = apply(state, 'player-1', { type: 'play', card: 31 }, assert);
      assert.equal(state.discardPile.at(-1), 31);
    },
  },
  {
    name: 'draw and pass retain privacy while draw-pile replenishment preserves the top discard',
    players: 2,
    run({ assert }) {
      let state = createControlledState();
      state.hands[0][40] = 1;
      state.drawPile = [];
      state.discardPile = [1, 18, 31, 5];
      const totalBefore = totalCards(state);
      state = apply(state, 'player-1', { type: 'draw' }, assert, seededRandom(9));
      assert.equal(state.discardPile.at(-1), 5);
      assert.equal(totalCards(state), totalBefore);
      if (state.drawnPlayerId === 'player-1') {
        state = apply(state, 'player-1', { type: 'pass' }, assert);
      }
      assert.equal(state.currentTurn, 'player-2');
    },
  },
  {
    name: 'last-card declaration prevents a catch and a missed declaration can be caught',
    players: 2,
    run({ assert }) {
      let declared = createControlledState();
      declared.hands[0][1] = 1;
      declared.hands[0][2] = 1;
      declared = apply(declared, 'player-1', { type: 'declareLastCard' }, assert);
      declared = apply(declared, 'player-1', { type: 'play', card: 1 }, assert);
      assert.equal(declared.undeclaredPlayerId, null);

      let missed = createControlledState();
      missed.hands[0][1] = 1;
      missed.hands[0][2] = 1;
      missed = apply(missed, 'player-1', { type: 'play', card: 1 }, assert);
      assert.equal(missed.undeclaredPlayerId, 'player-1');
      const before = handSize(missed, 'player-1');
      missed = apply(missed, 'player-2', { type: 'catchMissedDeclaration' }, assert);
      assert.equal(handSize(missed, 'player-1'), before + 2);
      assert.equal(missed.undeclaredPlayerId, null);
    },
  },
  {
    name: 'Wild Draw Four challenge checks the color before the wild was played',
    players: 2,
    run({ assert }) {
      let illegal = createControlledState();
      illegal.hands[0][WILD_DRAW_FOUR] = 1;
      illegal.hands[0][3] = 1;
      illegal = apply(
        illegal,
        'player-1',
        { type: 'play', card: WILD_DRAW_FOUR, color: COLORS.BLUE },
        assert,
      );
      assert.equal(illegal.challengePlayerId, 'player-2');
      illegal = apply(illegal, 'player-2', { type: 'challenge' }, assert);
      assert.equal(handSize(illegal, 'player-1'), 5);
      assert.equal(illegal.currentTurn, 'player-2');

      let legal = createControlledState();
      legal.hands[0][WILD_DRAW_FOUR] = 1;
      legal.hands[0][16] = 1;
      legal = apply(
        legal,
        'player-1',
        { type: 'play', card: WILD_DRAW_FOUR, color: COLORS.GREEN },
        assert,
      );
      legal = apply(legal, 'player-2', { type: 'challenge' }, assert);
      assert.equal(handSize(legal, 'player-2'), 6);
      assert.equal(legal.currentTurn, 'player-1');
    },
  },
  {
    name: 'accepting a final legal Wild Draw Four applies its penalty before scoring',
    players: 2,
    run({ assert }) {
      let state = createControlledState();
      state.hands[0][WILD_DRAW_FOUR] = 1;
      state.hands[1][14] = 1;
      state = apply(
        state,
        'player-1',
        { type: 'play', card: WILD_DRAW_FOUR, color: COLORS.BLUE },
        assert,
      );
      assert.equal(state.phase, PHASES.ACTIVE);
      assert.equal(state.pendingOutPlayerId, 'player-1');
      state = apply(state, 'player-2', { type: 'acceptDraw' }, assert);
      assert.equal(state.phase, PHASES.ROUND_FINISHED);
      assert.equal(handSize(state, 'player-2'), 5);
      assert.equal(state.roundWinner, 'player-1');
    },
  },
  {
    name: 'round scoring uses number, action, and wild values',
    players: 3,
    run({ assert }) {
      let state = createControlledState(3);
      state.hands[0][0] = 1;
      state.hands[1][WILD] = 1;
      state.hands[1][25] = 1;
      state.hands[2][48] = 1;
      assert.equal(handScore(state, 'player-2'), 70);
      state = apply(state, 'player-1', { type: 'play', card: 0 }, assert);
      assert.equal(state.phase, PHASES.ROUND_FINISHED);
      assert.equal(state.roundWinner, 'player-1');
      assert.equal(state.roundPoints, 79);
      assert.equal(state.scores[0], 79);
    },
  },
  {
    name: 'opening wild requires its first player to choose and opening Draw Four is forbidden',
    players: 2,
    run({ assert }) {
      let state = createControlledState();
      state.discardPile = [WILD];
      state.currentColor = null;
      mustReject(state, 'player-2', { type: 'chooseColor', color: COLORS.BLUE }, assert);
      mustReject(state, 'player-1', { type: 'play', card: WILD, color: COLORS.BLUE }, assert);
      state = apply(
        state,
        'player-1',
        { type: 'chooseColor', color: COLORS.BLUE },
        assert,
      );
      assert.equal(state.currentColor, COLORS.BLUE);
      for (let seed = 0; seed < 256; seed += 1) {
        const created = createColorMatch({ seed, players: makePlayers(2) });
        assert.notEqual(created.discardPile.at(-1), WILD_DRAW_FOUR);
        if (created.discardPile.at(-1) === WILD) assert.equal(created.currentColor, null);
      }
    },
  },
  {
    name: 'dealer rotates each round and the first player to 500 wins the match',
    players: 3,
    run({ assert }) {
      let rotation = createControlledState(3);
      rotation.phase = PHASES.ROUND_FINISHED;
      rotation.currentTurn = null;
      rotation.roundWinner = 'player-2';
      rotation = apply(rotation, 'player-2', { type: 'nextRound' }, assert);
      assert.equal(rotation.roundNumber, 2);
      assert.equal(rotation.dealer, 'player-1');

      let match = createControlledState(3);
      match.scores[0] = 490;
      match.hands[0][0] = 1;
      match.hands[1][9] = 1;
      match.hands[2][1] = 1;
      match = apply(match, 'player-1', { type: 'play', card: 0 }, assert);
      assert.equal(match.phase, PHASES.FINISHED);
      assert.equal(match.winner, 'player-1');
      assert.equal(match.scores[0], 500);
    },
  },
  {
    name: 'rematch requires all fixed seats and resets scores with the original seating',
    players: 3,
    run({ assert }) {
      let state = createControlledState(3);
      state.phase = PHASES.FINISHED;
      state.winner = 'player-2';
      state.currentTurn = null;
      state.scores[1] = 500;
      state = apply(state, 'player-1', { type: 'rematch' }, assert);
      mustReject(state, 'player-1', { type: 'rematch' }, assert);
      state = apply(state, 'player-2', { type: 'rematch' }, assert);
      assert.equal(state.phase, PHASES.FINISHED);
      state = apply(state, 'player-3', { type: 'rematch' }, assert);
      assert.equal(state.phase, PHASES.ACTIVE);
      assert.deepEqual(state.scores, [0, 0, 0]);
      assert.deepEqual(state.rematchVotes, [false, false, false]);
      assert.deepEqual(state.playerIds, ['player-1', 'player-2', 'player-3']);
      assert.equal(state.dealer, 'player-3');
    },
  },
  {
    name: 'per-seat views reveal one hand only and expose authority-derived controls',
    players: 2,
    run({ assert }) {
      const state = createControlledState();
      state.hands[0][1] = 1;
      state.hands[0][WILD] = 1;
      state.hands[1][16] = 1;
      state.drawnPlayerId = 'player-1';
      state.drawnCard = WILD;
      const players = makePlayers(2);
      const first = viewColorMatch({ state, viewer: 'player-1', players, revision: 7 });
      const second = viewColorMatch({ state, viewer: 'player-2', players, revision: 7 });
      assert.equal(first.handCounts[1], 1);
      assert.equal(first.handCounts[WILD], 1);
      assert.equal(second.handCounts[1], 0);
      assert.equal(second.handCounts[WILD], 0);
      assert.equal(first.drawnCard, WILD);
      assert.equal(second.drawnCard, null);
      assert.deepEqual(first.cardCounts, [2, 1]);
      assert.deepEqual(second.cardCounts, [2, 1]);
      assert.deepEqual(first.legalCards, [WILD]);
      assert.equal(first.canPass, true);
      for (const secret of [
        'hands',
        'drawPile',
        'discardPile',
        'wildDrawFourWasLegal',
        'wildDrawFourPlayerId',
        'pendingOutPlayerId',
      ]) {
        assert.equal(Object.hasOwn(first, secret), false);
        assert.equal(Object.hasOwn(second, secret), false);
      }
      first.handCounts[1] = 0;
      assert.equal(state.hands[0][1], 1);
    },
  },
  {
    name: 'simulation host serializes a real turn without leaking opponent cards',
    players: 8,
    seed: 0x57415645,
    async run({ host, players, assert }) {
      const before = await Promise.all(players.map((player) => host.viewForSeat(player.seat)));
      for (let index = 0; index < before.length; index += 1) {
        assert.equal(sum(before[index].handCounts), before[index].cardCounts[index]);
        for (let other = 0; other < before.length; other += 1) {
          if (other !== index) {
            assert.notDeepEqual(before[index].handCounts, host.stateSnapshot().hands[other]);
          }
        }
      }
      const state = host.stateSnapshot();
      const turnSeat = players.find((player) => player.id === state.currentTurn).seat;
      let view = await host.viewForSeat(turnSeat);
      if (view.canChooseColor) {
        const result = await host.dispatchAction(turnSeat, {
          type: 'chooseColor',
          color: COLORS.RED,
        });
        assert.equal(result.accepted, true);
        view = await host.viewForSeat(turnSeat);
      }
      const action = view.legalCards.length > 0
        ? {
            type: 'play',
            card: view.legalCards[0],
            ...(view.legalCards[0] >= WILD ? { color: COLORS.BLUE } : {}),
          }
        : { type: 'draw' };
      const result = await host.dispatchAction(turnSeat, action);
      assert.equal(result.accepted, true);
      assert.equal(result.revision, 1);
    },
  },
  {
    name: 'malformed and out-of-turn actions never mutate state or consume randomness',
    players: 8,
    run({ assert }) {
      const state = createControlledState(8);
      state.hands[0][1] = 1;
      state.hands[0][WILD] = 1;
      const random = { nextInt() { throw new Error('Rejected input consumed randomness'); }, nextFloat() { throw new Error('Rejected input consumed randomness'); } };
      for (const [actor, action] of [
        ['unknown', { type: 'draw' }],
        ['player-2', { type: 'draw' }],
        ['player-2', { type: 'play', card: 1 }],
        ['player-1', null], ['player-1', []], ['player-1', {}],
        ['player-1', { type: 'play', card: '1' }],
        ['player-1', { type: 'play', card: -1 }],
        ['player-1', { type: 'play', card: 54 }],
        ['player-1', { type: 'play', card: 2 }],
        ...[null, '0', -1, 4, 0.5].map((color) => ['player-1', { type: 'play', card: WILD, color }]),
        ['player-1', { type: 'pass' }], ['player-1', { type: 'challenge' }],
        ['player-1', { type: 'acceptDraw' }], ['player-1', { type: 'rematch' }],
        ['player-1', { type: 'nextRound' }], ['player-1', { type: 'unsupported' }],
      ]) {
        const before = JSON.stringify(state);
        const result = reduceColorMatch({ state, playerId: actor, action, random });
        assert.equal(result.accepted, false, JSON.stringify(action));
        assert.equal(JSON.stringify(state), before);
      }
    },
  },
  {
    name: 'challenge window permits only its target to resolve it and exposes no secret evidence',
    players: 8,
    run({ assert }) {
      let state = createControlledState(8);
      state.hands[0][WILD_DRAW_FOUR] = 1;
      state.hands[0][1] = 1;
      state = apply(state, 'player-1', { type: 'play', card: WILD_DRAW_FOUR, color: COLORS.BLUE }, assert);
      for (const action of [{ type: 'draw' }, { type: 'pass' }, { type: 'play', card: WILD }, { type: 'chooseColor', color: COLORS.RED }]) {
        mustReject(state, 'player-2', action, assert);
      }
      for (let seat = 1; seat <= 8; seat += 1) {
        const viewer = `player-${seat}`;
        const view = viewColorMatch({ state, viewer, players: makePlayers(8), revision: 3 });
        assert.deepEqual(view.legalCards, []);
        assert.equal(view.canDraw, false);
        assert.equal(view.canChallenge, seat === 2);
        assert.equal(view.canAcceptDraw, seat === 2);
        assert.equal(Object.hasOwn(view, 'wildDrawFourWasLegal'), false);
        if (seat !== 2) mustReject(state, viewer, { type: 'challenge' }, assert);
      }
      state = apply(state, 'player-2', { type: 'challenge' }, assert);
      assert.equal(state.currentTurn, 'player-2');
      assert.equal(handSize(state, 'player-1'), 5);
    },
  },
  {
    name: 'last-card self-correction and catches expire only when a valid turn continues',
    players: 3,
    run({ assert }) {
      let state = createControlledState(3);
      state.hands[0][1] = 1;
      state.hands[0][2] = 1;
      state.hands[1][3] = 1;
      state.hands[1][4] = 1;
      state = apply(state, 'player-1', { type: 'play', card: 1 }, assert);
      mustReject(state, 'player-3', { type: 'draw' }, assert);
      mustReject(state, 'player-2', { type: 'play', card: 54 }, assert);
      assert.equal(state.undeclaredPlayerId, 'player-1');
      let corrected = apply(state, 'player-1', { type: 'declareLastCard' }, assert);
      assert.equal(corrected.undeclaredPlayerId, null);
      mustReject(corrected, 'player-3', { type: 'catchMissedDeclaration' }, assert);
      state = apply(state, 'player-2', { type: 'play', card: 3 }, assert);
      assert.equal(state.undeclaredPlayerId, 'player-2');
      mustReject(state, 'player-2', { type: 'catchMissedDeclaration' }, assert);
      state = apply(state, 'player-3', { type: 'catchMissedDeclaration' }, assert);
      assert.equal(handSize(state, 'player-2'), 3);
      assert.equal(state.currentTurn, 'player-3');
    },
  },
  {
    name: 'final draw penalties contribute exactly to scoring and clear all action controls',
    players: 3,
    run({ assert }) {
      for (const [card, response, penalty] of [[RANKS.DRAW_TWO, null, 2], [WILD_DRAW_FOUR, 'acceptDraw', 4], [WILD_DRAW_FOUR, 'challenge', 6]]) {
        let state = createControlledState(3);
        state.hands[0][card] = 1;
        state.hands[1][9] = 1;
        state.hands[2][WILD] = 1;
        state.drawPile = Array(6).fill(8);
        state = apply(state, 'player-1', { type: 'play', card, color: COLORS.GREEN }, assert);
        if (response) state = apply(state, 'player-2', { type: response }, assert);
        assert.equal(state.roundPoints, 59 + penalty * 8);
        assert.equal(handSize(state, 'player-2'), 1 + penalty);
        assert.equal(state.currentTurn, null);
        assert.equal(state.pendingPenalty, 0);
        assert.equal(state.pendingOutPlayerId, null);
        for (const player of makePlayers(3)) {
          const view = viewColorMatch({ state, viewer: player.id, players: makePlayers(3), revision: 4 });
          assert.deepEqual(view.legalCards, []);
          for (const flag of ['canDraw', 'canPass', 'canDeclareLastCard', 'canCatchMissedDeclaration', 'canChallenge', 'canAcceptDraw', 'canChooseColor', 'canRematch']) assert.equal(view[flag], false, flag);
          assert.equal(view.canStartNextRound, true);
          mustReject(state, player.id, { type: 'draw' }, assert);
        }
      }
    },
  },
  {
    name: 'eight-seat rematch waits for every distinct voter and views own all returned arrays',
    players: 8,
    run({ assert }) {
      let state = createControlledState(8);
      state.phase = PHASES.FINISHED;
      state.currentTurn = null;
      state.winner = 'player-1';
      state.scores[0] = 500;
      for (let seat = 1; seat <= 7; seat += 1) {
        state = apply(state, `player-${seat}`, { type: 'rematch' }, assert);
        assert.equal(state.phase, PHASES.FINISHED);
        mustReject(state, `player-${seat}`, { type: 'rematch' }, assert);
      }
      state = apply(state, 'player-8', { type: 'rematch' }, assert);
      assert.equal(state.phase, PHASES.ACTIVE);
      assert.deepEqual(state.scores, Array(8).fill(0));
      const before = JSON.stringify(state);
      for (const player of makePlayers(8)) {
        const view = viewColorMatch({ state, viewer: player.id, players: makePlayers(8), revision: 1 });
        for (const value of Object.values(view)) if (Array.isArray(value)) value.fill(null);
      }
      assert.equal(JSON.stringify(state), before);
    },
  },
  {
    name: 'deterministic multi-round simulation conserves the full deck and verifies every seat view',
    players: 8,
    run({ assert }) {
      for (let count = 2; count <= 8; count += 1) {
        const players = makePlayers(count);
        let state = createColorMatch({ seed: count * 12345, players });
        const random = seededRandom(count * 98765);
        for (let step = 0; step < 400; step += 1) {
          assert.equal(totalCards(state), DECK_CARDS);
          assert.ok(state.hands.every((hand) => hand.every((copies) => Number.isInteger(copies) && copies >= 0)));
          for (const player of players) {
            const view = viewColorMatch({ state, viewer: player.id, players, revision: step });
            assert.equal(sum(view.handCounts), handSize(state, player.id));
            assert.deepEqual(view.cardCounts, state.playerIds.map((id) => handSize(state, id)));
            if (state.currentTurn !== player.id) assert.deepEqual(view.legalCards, []);
          }
          if (state.phase === PHASES.FINISHED) break;
          if (state.phase === PHASES.ROUND_FINISHED) {
            state = apply(state, players[0].id, { type: 'nextRound' }, assert, random);
            continue;
          }
          const actor = state.currentTurn;
          const view = viewColorMatch({ state, viewer: actor, players, revision: step });
          const card = view.legalCards.find((candidate) => candidate < WILD_DRAW_FOUR) ?? view.legalCards[0];
          const action = view.canChooseColor ? { type: 'chooseColor', color: step % 4 }
            : view.canAcceptDraw ? { type: step % 2 ? 'challenge' : 'acceptDraw' }
            : card !== undefined ? { type: 'play', card, color: step % 4 }
            : view.canPass ? { type: 'pass' } : { type: 'draw' };
          state = apply(state, actor, action, assert, random);
        }
      }
    },
  },
  {
    name: 'fixed-roster surrender rejects and timeout returns a fail-closed end policy',
    players: 2,
    run({ assert }) {
      const state = createControlledState();
      mustReject(state, 'player-1', { type: 'surrender' }, assert, 'unsupportedAction');
      const timeout = playerTimedOutColorMatch({ state, playerId: 'player-2' });
      assert.equal(timeout.ended, true);
      assert.equal(timeout.reason, 'player-timeout');
      assert.equal(timeout.events[0].playerId, 'player-2');
      timeout.state.scores[0] = 99;
      assert.equal(state.scores[0], 0);
    },
  },
];

function apply(state, playerId, action, assert, random = seededRandom(0x554e4f)) {
  const result = reduceColorMatch({ state, playerId, action, random, revision: 0, requestId: 1 });
  assert.equal(result.accepted, true, result.reason ?? result.code);
  return result.state;
}

function mustReject(state, playerId, action, assert, code) {
  const before = JSON.stringify(state);
  const result = reduceColorMatch({
    state,
    playerId,
    action,
    random: seededRandom(0x554e4f),
    revision: 0,
    requestId: 1,
  });
  assert.equal(result.accepted, false);
  if (code !== undefined) assert.equal(result.code, code);
  assert.equal(JSON.stringify(state), before);
  return result;
}

function makePlayers(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `player-${index + 1}`,
    seat: index + 1,
    name: `Player ${index + 1}`,
  }));
}

function expandedHands(state) {
  return state.hands.map((hand) => hand.flatMap((count, card) => Array(count).fill(card)));
}

function totalCards(state) {
  return state.drawPile.length
    + state.discardPile.length
    + state.playerIds.reduce((total, playerId) => total + handSize(state, playerId), 0);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
