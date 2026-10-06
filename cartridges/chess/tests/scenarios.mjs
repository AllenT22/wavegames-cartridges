import { __testing, create, reduce, view } from '../rules/index.mjs';
import { decodeHistory, decodeLegalMoves } from '../ui/view-codec.mjs';

const white = (type) => ({ color: 'white', type });
const black = (type) => ({ color: 'black', type });
const at = __testing.squareIndex;

export const scenarios = [
  {
    name: 'draw offers survive the offerers move and expire on the recipients move',
    players: 2,
    async run({ host, assert }) {
      await host.dispatchAction(1, { type: 'offerDraw' });
      await play(host, [[1, 'e2', 'e4']], assert);
      const offered = await host.viewForSeat(2);
      assert.equal(offered.drawOfferBy, 'player-1');
      assert.equal(offered.canAcceptDraw, true);
      await play(host, [[2, 'e7', 'e5']], assert);
      assert.equal((await host.viewForSeat(1)).drawOfferBy, null);
      await host.dispatchAction(1, { type: 'offerDraw' });
      await play(host, [[1, 'g1', 'f3']], assert);
      assert.equal((await host.dispatchAction(2, { type: 'acceptDraw' })).accepted, true);
      assert.equal((await host.viewForSeat(1)).status, 'drawAgreement');
    },
  },
  {
    name: 'spectators cannot answer draw offers and detached views cannot mutate authority',
    players: 2,
    async run({ assert }) {
      const players = [{ id: 'player-1' }, { id: 'player-2' }];
      const state = reduce({ state: create({ players }), playerId: 'player-1', action: { type: 'offerDraw' } }).state;
      const before = JSON.stringify(state);
      const spectator = view({ state, viewer: 'observer', players, revision: 1 });
      assert.equal(spectator.myColor, null);
      for (const permission of ['canAcceptDraw', 'canDeclineDraw', 'canResign', 'canOfferDraw', 'canRequestRematch']) assert.equal(spectator[permission], false);
      assert.equal(spectator.legalMoves, '');
      assert.equal(reduce({ state, playerId: 'observer', action: { type: 'acceptDraw' } }).accepted, false);
      spectator.players[0].id = 'observer';
      spectator.rematchVotes[0] = true;
      assert.equal(JSON.stringify(state), before);
    },
  },
  {
    name: 'malformed and invalid actions leave the authority untouched',
    players: 2,
    async run({ assert }) {
      const state = create({ players: [{ id: 'player-1' }, { id: 'player-2' }] });
      const before = JSON.stringify(state);
      for (const action of [null, [], 'move', {}, { type: 'move', from: '52', to: 36 }, { type: 'move', from: -1, to: 36 }, { type: 'move', from: 52, to: 64 }, { type: 'move', from: 52, to: 36, promotion: 'king' }, { type: 'move', from: 52, to: 36, promotion: 'queen' }]) {
        assert.equal(reduce({ state, playerId: 'player-1', action }).accepted, false);
        assert.equal(JSON.stringify(state), before);
      }
      const accepted = reduce({ state, playerId: 'player-1', action: { type: 'move', from: at('e2'), to: at('e4') } });
      assert.equal(accepted.accepted, true);
      assert.equal(JSON.stringify(state), before);
    },
  },
  {
    name: 'castling rights cannot return after a rook moves or is captured',
    players: 2,
    async run({ assert }) {
      let state = __testing.createPosition({ pieces: { e1: white('king'), h1: white('rook'), e8: black('king'), a8: black('rook') } });
      state = __testing.applyMove(state, 'h1', 'h2');
      state = __testing.applyMove(state, 'a8', 'a7');
      state = __testing.applyMove(state, 'h2', 'h1');
      state = __testing.applyMove(state, 'a7', 'a8');
      assert.equal(__testing.legalMovesFrom(state, at('e1')).some((move) => move.isCastle), false);
      const capture = __testing.createPosition({ turnColor: 'black', pieces: { e1: white('king'), h1: white('rook'), e8: black('king'), h8: black('rook') } });
      assert.equal(__testing.applyMove(capture, 'h8', 'h1').whiteCanCastleKingSide, false);
    },
  },
  {
    name: 'en passant expires after one reply and cannot expose a horizontal check',
    players: 2,
    async run({ host, assert }) {
      await play(host, [[1, 'e2', 'e4'], [2, 'a7', 'a6'], [1, 'e4', 'e5'], [2, 'd7', 'd5'], [1, 'g1', 'f3'], [2, 'a6', 'a5']], assert);
      assert.equal(decodeLegalMoves((await host.viewForSeat(1)).legalMoves).some((move) => move.isEnPassant), false);
      const pinned = __testing.createPosition({ pieces: { h5: white('king'), g5: white('pawn'), a8: black('king'), a5: black('rook'), f5: black('pawn') }, enPassantTarget: 'f6' });
      assert.equal(__testing.legalMovesFrom(pinned, at('g5')).some((move) => move.to === at('f6')), false);
    },
  },
  {
    name: 'promotion requires a choice and a finished board rejects further moves',
    players: 2,
    async run({ assert }) {
      const state = __testing.createPosition({ pieces: { e1: white('king'), e8: black('king'), a7: white('pawn') } });
      const action = { type: 'move', from: at('a7'), to: at('a8') };
      const before = JSON.stringify(state);
      assert.equal(reduce({ state, playerId: 'player-1', action }).accepted, false);
      assert.equal(JSON.stringify(state), before);
      const promoted = reduce({ state, playerId: 'player-1', action: { ...action, promotion: 'knight' } });
      assert.equal(promoted.accepted, true);
      assert.equal(promoted.state.status, 'drawInsufficientMaterial');
      assert.equal(reduce({ state: promoted.state, playerId: 'player-2', action: { type: 'move', from: at('e8'), to: at('e7') } }).accepted, false);
    },
  },
  {
    name: 'initial position has twenty legal moves',
    players: 2,
    async run({ host, assert }) {
      const whiteView = await host.viewForSeat(1);
      const blackView = await host.viewForSeat(2);
      assert.equal(decodeLegalMoves(whiteView.legalMoves).length, 20);
      assert.deepEqual(
        decodeLegalMoves(whiteView.legalMoves).filter((move) => move.from === at('e2')).map((move) => __testing.squareName(move.to)).sort(),
        ['e3', 'e4'],
      );
      assert.equal(decodeLegalMoves(blackView.legalMoves).length, 0);
      assert.equal(whiteView.myColor, 'white');
      assert.equal(blackView.myColor, 'black');
    },
  },
  {
    name: 'checkmate is authoritative and algebraic notation includes mate',
    players: 2,
    async run({ host, assert }) {
      await play(host, [
        [1, 'e2', 'e4'], [2, 'e7', 'e5'], [1, 'f1', 'c4'], [2, 'b8', 'c6'],
        [1, 'd1', 'h5'], [2, 'g8', 'f6'], [1, 'h5', 'f7'],
      ], assert);
      const view = await host.viewForSeat(1);
      assert.equal(view.status, 'checkmate');
      assert.equal(view.winner, 'player-1');
      assert.equal(decodeHistory(view.history).at(-1), 'Qxf7#');
      assert.equal(view.legalMoves, '');
    },
  },
  {
    name: 'castling moves the rook and cannot cross attack',
    players: 2,
    async run({ assert }) {
      const castlePosition = __testing.createPosition({
        pieces: { e1: white('king'), h1: white('rook'), e8: black('king') },
      });
      const castleMoves = __testing.legalMovesFrom(castlePosition, at('e1'));
      const castle = castleMoves.find((move) => move.to === at('g1'));
      assert.equal(castle?.isCastle, true);
      const next = __testing.applyMove(castlePosition, 'e1', 'g1');
      assert.deepEqual(next.board[at('g1')], white('king'));
      assert.deepEqual(next.board[at('f1')], white('rook'));
      assert.equal(next.board[at('h1')], null);
      assert.equal(next.history[0], 'O-O');

      const queenSide = __testing.createPosition({
        pieces: { e1: white('king'), a1: white('rook'), e8: black('king') },
      });
      const queenCastle = __testing.applyMove(queenSide, 'e1', 'c1');
      assert.deepEqual(queenCastle.board[at('c1')], white('king'));
      assert.deepEqual(queenCastle.board[at('d1')], white('rook'));
      assert.equal(queenCastle.history[0], 'O-O-O');

      const attacked = __testing.createPosition({
        pieces: { e1: white('king'), h1: white('rook'), e8: black('king'), f8: black('rook') },
      });
      assert.equal(__testing.legalMovesFrom(attacked, at('e1')).some((move) => move.isCastle), false);
    },
  },
  {
    name: 'en passant removes the passed pawn',
    players: 2,
    async run({ host, assert }) {
      await play(host, [
        [1, 'e2', 'e4'], [2, 'a7', 'a6'], [1, 'e4', 'e5'], [2, 'd7', 'd5'],
      ], assert);
      const before = await host.viewForSeat(1);
      const enPassant = decodeLegalMoves(before.legalMoves).find((move) => move.from === at('e5') && move.to === at('d6'));
      assert.equal(enPassant?.isEnPassant, true);
      const result = await host.dispatchAction(1, { type: 'move', from: at('e5'), to: at('d6') });
      assert.equal(result.accepted, true);
      const next = await host.viewForSeat(1);
      assert.equal(next.board[at('d5')], '.');
      assert.equal(next.board[at('d6')], 'P');
      assert.equal(decodeHistory(next.history).at(-1), 'exd6');

      const pinnedEnPassant = __testing.createPosition({
        pieces: {
          e1: white('king'), e5: white('pawn'), a8: black('king'), e8: black('rook'), d5: black('pawn'),
        },
        enPassantTarget: 'd6',
      });
      assert.equal(
        __testing.legalMovesFrom(pinnedEnPassant, at('e5')).some((move) => move.to === at('d6')),
        false,
      );
    },
  },
  {
    name: 'promotion offers and applies all four choices',
    players: 2,
    async run({ assert }) {
      const position = __testing.createPosition({
        pieces: { e1: white('king'), e8: black('king'), a7: white('pawn') },
      });
      const promotions = __testing.legalMovesFrom(position, at('a7')).filter((move) => move.to === at('a8'));
      assert.deepEqual(promotions.map((move) => move.promotion), ['queen', 'rook', 'bishop', 'knight']);
      const next = __testing.applyMove(position, 'a7', 'a8', 'knight');
      assert.deepEqual(next.board[at('a8')], white('knight'));
      assert.equal(next.history.at(-1), 'a8=N');
    },
  },
  {
    name: 'stalemate and insufficient material are recognized',
    players: 2,
    async run({ assert }) {
      const stalemate = __testing.createPosition({
        turnColor: 'black',
        pieces: { a8: black('king'), c6: white('king'), c7: white('queen') },
      });
      assert.equal(__testing.isInCheck(stalemate, 'black'), false);
      assert.deepEqual(__testing.allLegalMoves(stalemate), []);
      const insufficient = __testing.createPosition({
        pieces: { a8: black('king'), b8: black('bishop'), h1: white('king') },
      });
      assert.equal(__testing.hasInsufficientMaterial(insufficient.board), true);

      const makesStalemate = __testing.createPosition({
        pieces: { a8: black('king'), c6: white('king'), b6: white('queen') },
      });
      assert.equal(__testing.applyMove(makesStalemate, 'b6', 'c7').status, 'stalemate');

      const lastCapture = __testing.createPosition({
        pieces: { e1: white('king'), b5: white('bishop'), e8: black('king'), c6: black('knight') },
      });
      assert.equal(__testing.applyMove(lastCapture, 'b5', 'c6').status, 'drawInsufficientMaterial');
    },
  },
  {
    name: 'threefold repetition ends the game',
    players: 2,
    async run({ host, assert }) {
      for (let cycle = 0; cycle < 2; cycle += 1) {
        await play(host, [
          [1, 'g1', 'f3'], [2, 'g8', 'f6'], [1, 'f3', 'g1'], [2, 'f6', 'g8'],
        ], assert);
      }
      const view = await host.viewForSeat(1);
      assert.equal(view.status, 'drawRepetition');
      assert.equal(view.winner, null);
      assert.equal(view.moveCount, 8);
    },
  },
  {
    name: 'fifty-move rule ends the game at one hundred halfmoves',
    players: 2,
    async run({ assert }) {
      const almostFifty = __testing.createPosition({
        pieces: { e1: white('king'), a1: white('rook'), e8: black('king'), h8: black('rook') },
        halfmoveClock: 99,
      });
      const next = __testing.applyMove(almostFifty, 'a1', 'a2');
      assert.equal(next.halfmoveClock, 100);
      assert.equal(next.status, 'drawFiftyMove');
    },
  },
  {
    name: 'king safety removes pinned moves and notation disambiguates',
    players: 2,
    async run({ assert }) {
      const pinned = __testing.createPosition({
        pieces: { e1: white('king'), e2: white('rook'), a8: black('king'), e8: black('rook') },
      });
      assert.equal(__testing.legalMovesFrom(pinned, at('e2')).some((move) => move.to === at('d2')), false);

      const ambiguous = __testing.createPosition({
        pieces: { e1: white('king'), e8: black('king'), b1: white('knight'), f1: white('knight') },
      });
      const next = __testing.applyMove(ambiguous, 'b1', 'd2');
      assert.equal(next.history.at(-1), 'Nbd2');
    },
  },
  {
    name: 'draw offers require the opponent to answer',
    players: 2,
    async run({ host, assert }) {
      const offered = await host.dispatchAction(1, { type: 'offerDraw' });
      assert.equal(offered.accepted, true);
      const selfAccept = await host.dispatchAction(1, { type: 'acceptDraw' });
      assert.equal(selfAccept.accepted, false);
      assert.equal(selfAccept.revision, offered.revision);
      const secondView = await host.viewForSeat(2);
      assert.equal(secondView.canAcceptDraw, true);
      const declined = await host.dispatchAction(2, { type: 'declineDraw' });
      assert.equal(declined.accepted, true);
      assert.equal((await host.viewForSeat(1)).drawOfferBy, null);
      await host.dispatchAction(2, { type: 'offerDraw' });
      await host.dispatchAction(1, { type: 'acceptDraw' });
      const final = await host.viewForSeat(2);
      assert.equal(final.status, 'drawAgreement');
      assert.equal(final.winner, null);
    },
  },
  {
    name: 'resignation and two rematch votes swap colors',
    players: 2,
    async run({ host, assert }) {
      const resignation = await host.dispatchAction(1, { type: 'resign' });
      assert.equal(resignation.accepted, true);
      assert.equal((await host.viewForSeat(1)).winner, 'player-2');
      const firstVote = await host.dispatchAction(1, { type: 'rematch' });
      assert.equal(firstVote.accepted, true);
      const duplicate = await host.dispatchAction(1, { type: 'rematch' });
      assert.equal(duplicate.accepted, false);
      assert.equal(duplicate.revision, firstVote.revision);
      const secondVote = await host.dispatchAction(2, { type: 'rematch' });
      assert.equal(secondVote.accepted, true);
      const reset = await host.viewForSeat(1);
      assert.equal(reset.status, 'playing');
      assert.equal(reset.players[0].id, 'player-2');
      assert.equal(reset.players[1].id, 'player-1');
      assert.equal(reset.turn, 'player-2');
      assert.equal(reset.moveCount, 0);
      assert.deepEqual(reset.rematchVotes, [false, false]);
    },
  },
  {
    name: 'rejected actions never advance revision',
    players: 2,
    async run({ host, assert }) {
      const wrongTurn = await host.dispatchAction(2, { type: 'move', from: at('e7'), to: at('e5') });
      assert.equal(wrongTurn.accepted, false);
      assert.equal(wrongTurn.revision, 0);
      const illegal = await host.dispatchAction(1, { type: 'move', from: at('e2'), to: at('e5') });
      assert.equal(illegal.accepted, false);
      assert.equal(illegal.revision, 0);
      const unknown = await host.dispatchAction(1, { type: 'teleport' });
      assert.equal(unknown.accepted, false);
      assert.equal(host.revision, 0);
      assert.equal((await host.viewForSeat(1)).moveCount, 0);
    },
  },
  {
    name: 'per-seat views expose only the viewers legal actions',
    players: 2,
    async run({ host, assert }) {
      const first = await host.viewForSeat(1);
      const second = await host.viewForSeat(2);
      assert.equal(first.viewer, 'player-1');
      assert.equal(second.viewer, 'player-2');
      assert.equal(decodeLegalMoves(first.legalMoves).length, 20);
      assert.equal(decodeLegalMoves(second.legalMoves).length, 0);
      assert.equal(first.board[0], 'r');
      assert.equal((await host.viewForSeat(2)).board[0], 'r');
      await host.dispatchAction(1, { type: 'move', from: at('e2'), to: at('e4') });
      assert.equal(decodeLegalMoves((await host.viewForSeat(1)).legalMoves).length, 0);
      assert.equal(decodeLegalMoves((await host.viewForSeat(2)).legalMoves).length, 20);
    },
  },
  {
    name: 'deterministic long play keeps authority and both views serializable',
    players: 2,
    async run({ host, assert }) {
      let cursor = 0x57415645;
      let plies = 0;
      while (plies < 220) {
        const first = await host.viewForSeat(1);
        const second = await host.viewForSeat(2);
        assert.equal(first.board, second.board);
        if (first.status !== 'playing') break;
        const current = first.turn === 'player-1' ? first : second;
        const currentMoves = decodeLegalMoves(current.legalMoves);
        assert.ok(currentMoves.length > 0);
        cursor = (Math.imul(cursor, 1664525) + 1013904223) >>> 0;
        const chosen = currentMoves[cursor % currentMoves.length];
        const promotion = chosen.promotion ?? undefined;
        const result = await host.dispatchAction(current.turn === 'player-1' ? 1 : 2, {
          type: 'move',
          from: chosen.from,
          to: chosen.to,
          ...(promotion === undefined ? {} : { promotion }),
        });
        assert.equal(result.accepted, true);
        plies += 1;
      }
      assert.ok(plies >= 20);
      assert.equal(host.revision, plies);
    },
  },
  {
    name: 'API 1 omits wall-clock chess clocks',
    players: 2,
    async run({ host, assert }) {
      const view = await host.viewForSeat(1);
      assert.equal(Object.hasOwn(view, 'whiteTimeMs'), false);
      assert.equal(Object.hasOwn(view, 'blackTimeMs'), false);
      assert.equal(view.status, 'playing');
    },
  },
];

async function play(host, moves, assert) {
  for (const [seat, from, to, promotion] of moves) {
    const result = await host.dispatchAction(seat, {
      type: 'move',
      from: at(from),
      to: at(to),
      ...(promotion === undefined ? {} : { promotion }),
    });
    assert.equal(result.accepted, true, `${from}-${to}: ${result.reason ?? 'rejected'}`);
  }
}
