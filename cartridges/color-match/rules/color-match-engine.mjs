export const CARD_TYPES = 54;
export const DECK_CARDS = 108;
export const CARDS_PER_HAND = 7;
export const SCORE_TARGET = 500;
export const WILD = 52;
export const WILD_DRAW_FOUR = 53;
export const NO_CARD = null;

export const COLORS = Object.freeze({
  RED: 0,
  YELLOW: 1,
  GREEN: 2,
  BLUE: 3,
});

export const RANKS = Object.freeze({
  ZERO: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  SIX: 6,
  SEVEN: 7,
  EIGHT: 8,
  NINE: 9,
  SKIP: 10,
  REVERSE: 11,
  DRAW_TWO: 12,
});

export const PHASES = Object.freeze({
  ACTIVE: 'active',
  ROUND_FINISHED: 'roundFinished',
  FINISHED: 'finished',
});

export function createColorMatch({ seed, players }) {
  validatePlayers(players);
  if (!Number.isSafeInteger(seed)) throw new Error('Color Match requires an integer seed');
  // API 1 makes the seed authoritative. Initial shuffling is derived from it
  // without consuming the host stream, keeping Node and native hosts aligned.
  return resetMatch(players.map((player) => player.id), seededRandom(seed >>> 0));
}

export function reduceColorMatch({ state, playerId, action, random }) {
  const actorIndex = state.playerIds.indexOf(playerId);
  if (actorIndex < 0) return rejected('unknownPlayer', 'Unknown player');
  if (!isRecord(action) || typeof action.type !== 'string') {
    return rejected('invalidAction', 'Choose an action');
  }
  const next = cloneState(state);
  const rng = requireRandom(random);
  const actor = next.playerIds[actorIndex];

  if (action.type === 'declareLastCard') return declareLastCard(next, actor);
  if (action.type === 'catchMissedDeclaration') return catchMissedDeclaration(next, actor, rng);
  if (action.type === 'rematch') return voteForRematch(next, actorIndex, rng);
  if (action.type === 'nextRound') return beginNextRound(next, rng);
  if (action.type === 'surrender') {
    return rejected(
      'unsupportedAction',
      'Fixed-seat Color Match has no surrender action; leaving or timing out ends the match',
    );
  }
  if (next.phase !== PHASES.ACTIVE) {
    return rejected('phaseMismatch', 'The round is not active');
  }

  if (action.type === 'chooseColor') {
    return chooseOpeningWildColor(next, actor, action.color);
  }
  if (actor !== next.currentTurn) {
    return rejected('notYourTurn', 'Wait for your turn');
  }

  if (next.challengePlayerId !== null) {
    if (action.type === 'acceptDraw') return acceptWildDrawFour(next, actor, rng);
    if (action.type === 'challenge') return challengeWildDrawFour(next, actor, rng);
    return rejected('challengePending', 'Accept or challenge the Wild Draw Four');
  }
  if (next.currentColor === null) {
    return rejected('colorRequired', 'Choose the opening Wild color');
  }

  if (action.type === 'draw') return drawAction(next, actor, rng);
  if (action.type === 'pass') return passAction(next, actor);
  if (action.type === 'play') {
    return playAction(next, actor, action.card, action.color, rng);
  }
  return rejected('invalidAction', 'That Color Match action is not supported');
}

export function viewColorMatch({ state, viewer, players, revision }) {
  const viewerIndex = state.playerIds.indexOf(viewer);
  if (viewerIndex < 0) throw new Error('Color Match view requested for an unknown player');
  const playerRecords = new Map(players.map((player) => [player.id, player]));
  const cards = handSize(state, viewer);
  const viewerTurn = state.phase === PHASES.ACTIVE && state.currentTurn === viewer;
  const challengePending = state.challengePlayerId !== null;
  const legalCards = [];
  if (viewerTurn && !challengePending && state.currentColor !== null) {
    for (let card = 0; card < CARD_TYPES; card += 1) {
      if (state.hands[viewerIndex][card] === 0) continue;
      if (state.drawnPlayerId === viewer && state.drawnCard !== card) continue;
      if (cardIsPlayable(state, card)) legalCards.push(card);
    }
  }
  return {
    phase: state.phase,
    playerCount: state.playerIds.length,
    playerIds: [...state.playerIds],
    seats: state.playerIds.map((id, index) => playerRecords.get(id)?.seat ?? index + 1),
    viewer,
    currentTurn: state.currentTurn,
    winner: state.winner,
    currentColor: state.currentColor,
    direction: state.direction,
    drawPileCount: state.drawPile.length,
    pendingPenalty: state.pendingPenalty,
    challengePlayerId: state.challengePlayerId,
    undeclaredPlayerId: state.undeclaredPlayerId,
    roundWinner: state.roundWinner,
    roundNumber: state.roundNumber,
    drawnCard: state.drawnPlayerId === viewer ? state.drawnCard : NO_CARD,
    dealer: state.dealer,
    topCard: state.discardPile.at(-1) ?? NO_CARD,
    roundPoints: state.roundPoints,
    scores: [...state.scores],
    cardCounts: state.playerIds.map((id) => handSize(state, id)),
    handCounts: [...state.hands[viewerIndex]],
    rematchVotes: [...state.rematchVotes],
    legalCards,
    lastCardDeclared: state.declaredPlayerId === viewer,
    canDraw:
      viewerTurn && !challengePending && state.currentColor !== null
      && state.drawnPlayerId === null,
    canPass: viewerTurn && state.drawnPlayerId === viewer,
    canDeclareLastCard:
      state.phase === PHASES.ACTIVE
      && ((viewerTurn && cards === 2)
        || (state.undeclaredPlayerId === viewer && cards === 1)),
    canCatchMissedDeclaration:
      state.phase === PHASES.ACTIVE
      && state.undeclaredPlayerId !== null
      && state.undeclaredPlayerId !== viewer,
    canChallenge: viewerTurn && state.challengePlayerId === viewer,
    canAcceptDraw: viewerTurn && state.challengePlayerId === viewer,
    canChooseColor:
      viewerTurn
      && state.discardPile.at(-1) === WILD
      && state.currentColor === null,
    canStartNextRound: state.phase === PHASES.ROUND_FINISHED,
    canRematch: state.phase === PHASES.FINISHED && !state.rematchVotes[viewerIndex],
    revision,
  };
}

export function playerTimedOutColorMatch({ state, playerId }) {
  if (!state.playerIds.includes(playerId)) throw new Error('Timed-out player is not in Color Match');
  return {
    ended: true,
    reason: 'player-timeout',
    state: cloneState(state),
    events: [{ type: 'playerTimedOut', playerId }],
  };
}

function declareLastCard(state, actor) {
  const cards = handSize(state, actor);
  if (
    state.phase !== PHASES.ACTIVE
    || !((actor === state.currentTurn && cards === 2)
      || (state.undeclaredPlayerId === actor && cards === 1))
  ) {
    return rejected('illegalAction', 'Declare before playing down to one card');
  }
  state.declaredPlayerId = actor;
  if (state.undeclaredPlayerId === actor) closeDeclarationWindow(state);
  return accepted(state, [{ type: 'lastCardDeclared', playerId: actor }]);
}

function catchMissedDeclaration(state, actor, random) {
  const caught = state.undeclaredPlayerId;
  if (
    state.phase !== PHASES.ACTIVE
    || caught === null
    || caught === actor
    || handSize(state, caught) !== 1
  ) {
    return rejected('illegalAction', 'There is no vulnerable opponent to catch');
  }
  drawCards(state, caught, 2, random);
  closeDeclarationWindow(state);
  state.declaredPlayerId = null;
  return accepted(state, [{ type: 'missedDeclarationCaught', playerId: caught, by: actor, count: 2 }]);
}

function voteForRematch(state, actorIndex, random) {
  if (state.phase !== PHASES.FINISHED) {
    return rejected('phaseMismatch', 'The match must finish before a rematch');
  }
  if (state.rematchVotes[actorIndex]) {
    return rejected('illegalAction', 'Rematch already requested');
  }
  state.rematchVotes[actorIndex] = true;
  const actor = state.playerIds[actorIndex];
  if (!state.rematchVotes.every(Boolean)) {
    return accepted(state, [{ type: 'rematchWaiting', playerId: actor }]);
  }
  const reset = resetMatch(state.playerIds, random);
  return accepted(reset, [{ type: 'rematchStarted' }]);
}

function beginNextRound(state, random) {
  if (state.phase !== PHASES.ROUND_FINISHED) {
    return rejected('phaseMismatch', 'The current round is not finished');
  }
  startRound(state, random);
  return accepted(state, [{ type: 'roundStarted', roundNumber: state.roundNumber }]);
}

function chooseOpeningWildColor(state, actor, color) {
  if (
    actor !== state.currentTurn
    || state.discardPile.at(-1) !== WILD
    || state.currentColor !== null
    || !validColor(color)
  ) {
    return actor !== state.currentTurn
      ? rejected('notYourTurn', 'Wait for your turn')
      : rejected('illegalAction', 'A color is not waiting to be chosen');
  }
  closeDeclarationWindow(state);
  state.currentColor = color;
  return accepted(state, [{ type: 'colorChosen', playerId: actor, color }]);
}

function acceptWildDrawFour(state, actor, random) {
  closeDeclarationWindow(state);
  drawCards(state, actor, state.pendingPenalty, random);
  state.pendingPenalty = 0;
  state.challengePlayerId = null;
  state.wildDrawFourPlayerId = null;
  state.currentTurn = advance(state, actor);
  const events = [{ type: 'penaltyDrawn', playerId: actor, count: 4 }];
  const roundEvent = resolvePendingOut(state);
  if (roundEvent) events.push(roundEvent);
  return accepted(state, events);
}

function challengeWildDrawFour(state, actor, random) {
  closeDeclarationWindow(state);
  const offender = state.wildDrawFourPlayerId;
  const successful = state.wildDrawFourWasLegal === false;
  state.pendingPenalty = 0;
  state.challengePlayerId = null;
  state.wildDrawFourPlayerId = null;
  if (successful) {
    drawCards(state, offender, 4, random);
    state.pendingOutPlayerId = null;
    state.currentTurn = actor;
    return accepted(state, [{
      type: 'challengeWon',
      playerId: actor,
      offender,
      count: 4,
    }]);
  }
  drawCards(state, actor, 6, random);
  state.currentTurn = advance(state, actor);
  const events = [{ type: 'challengeLost', playerId: actor, count: 6 }];
  const roundEvent = resolvePendingOut(state);
  if (roundEvent) events.push(roundEvent);
  return accepted(state, events);
}

function drawAction(state, actor, random) {
  if (state.drawnPlayerId !== null) {
    return rejected('illegalAction', 'Play or pass after drawing');
  }
  closeDeclarationWindow(state);
  state.declaredPlayerId = null;
  const card = drawOne(state, actor, random);
  if (card === NO_CARD) return rejected('illegalAction', 'No card can be drawn');
  if (cardIsPlayable(state, card)) {
    state.drawnPlayerId = actor;
    state.drawnCard = card;
  } else {
    state.currentTurn = advance(state, actor);
  }
  return accepted(state, [{ type: 'cardDrawn', playerId: actor, count: 1 }]);
}

function passAction(state, actor) {
  if (state.drawnPlayerId !== actor) {
    return rejected('illegalAction', 'Pass is available only after drawing a playable card');
  }
  closeDeclarationWindow(state);
  state.drawnPlayerId = null;
  state.drawnCard = NO_CARD;
  state.currentTurn = advance(state, actor);
  return accepted(state, [{ type: 'passed', playerId: actor }]);
}

function playAction(state, actor, card, color, random) {
  const actorIndex = state.playerIds.indexOf(actor);
  if (
    !validCard(card)
    || state.hands[actorIndex][card] === 0
    || !cardIsPlayable(state, card)
    || (state.drawnPlayerId === actor && state.drawnCard !== card)
    || (card >= WILD && !validColor(color))
  ) {
    return rejected('illegalAction', 'That card cannot be played');
  }

  closeDeclarationWindow(state);
  const drawFourLegal = card !== WILD_DRAW_FOUR || !hasColor(state, actor, state.currentColor);
  state.hands[actorIndex][card] -= 1;
  state.discardPile.push(card);
  state.currentColor = card >= WILD ? color : cardColor(card);
  state.drawnPlayerId = null;
  state.drawnCard = NO_CARD;
  if (card === WILD_DRAW_FOUR) {
    state.wildDrawFourPlayerId = actor;
    state.wildDrawFourWasLegal = drawFourLegal;
  }

  const remaining = handSize(state, actor);
  if (remaining === 1 && state.declaredPlayerId !== actor) {
    state.undeclaredPlayerId = actor;
  }
  state.declaredPlayerId = null;
  applyPlayEffect(state, actor, card, random);
  const events = [{
    type: 'cardPlayed',
    playerId: actor,
    card,
    color: state.currentColor,
  }];
  if (remaining === 0) {
    if (card === WILD_DRAW_FOUR) {
      state.pendingOutPlayerId = actor;
    } else {
      events.push(finishRound(state, actor));
    }
  }
  return accepted(state, events);
}

function applyPlayEffect(state, actor, card, random) {
  const rank = cardRank(card);
  if (card === WILD_DRAW_FOUR) {
    const penalized = advance(state, actor);
    state.pendingPenalty = 4;
    state.challengePlayerId = penalized;
    state.currentTurn = penalized;
    return;
  }
  if (card === WILD || rank <= RANKS.NINE) {
    state.currentTurn = advance(state, actor);
    return;
  }
  if (rank === RANKS.SKIP) {
    state.currentTurn = advance(state, actor, 2);
    return;
  }
  if (rank === RANKS.REVERSE) {
    if (state.playerIds.length === 2) {
      state.currentTurn = actor;
    } else {
      state.direction = state.direction === 0 ? 1 : 0;
      state.currentTurn = advance(state, actor);
    }
    return;
  }
  const penalized = advance(state, actor);
  drawCards(state, penalized, 2, random);
  state.currentTurn = advance(state, penalized);
}

function resolvePendingOut(state) {
  const winner = state.pendingOutPlayerId;
  if (winner !== null && handSize(state, winner) === 0) {
    return finishRound(state, winner);
  }
  state.pendingOutPlayerId = null;
  return null;
}

function finishRound(state, winner) {
  let points = 0;
  for (const playerId of state.playerIds) {
    if (playerId !== winner) points += handScore(state, playerId);
  }
  const winnerIndex = state.playerIds.indexOf(winner);
  state.roundWinner = winner;
  state.roundPoints = points;
  state.scores[winnerIndex] = Math.min(0xffff, state.scores[winnerIndex] + points);
  state.currentTurn = null;
  state.drawnPlayerId = null;
  state.drawnCard = NO_CARD;
  state.pendingOutPlayerId = null;
  state.challengePlayerId = null;
  state.pendingPenalty = 0;
  closeDeclarationWindow(state);
  if (state.scores[winnerIndex] >= SCORE_TARGET) {
    state.phase = PHASES.FINISHED;
    state.winner = winner;
    return { type: 'matchWon', playerId: winner, points, score: state.scores[winnerIndex] };
  }
  state.phase = PHASES.ROUND_FINISHED;
  return { type: 'roundWon', playerId: winner, points, score: state.scores[winnerIndex] };
}

function resetMatch(playerIds, random) {
  const state = {
    playerIds: [...playerIds],
    hands: playerIds.map(() => Array(CARD_TYPES).fill(0)),
    drawPile: [],
    discardPile: [],
    scores: playerIds.map(() => 0),
    rematchVotes: playerIds.map(() => false),
    phase: PHASES.ACTIVE,
    currentTurn: null,
    winner: null,
    currentColor: null,
    direction: 0,
    pendingPenalty: 0,
    challengePlayerId: null,
    wildDrawFourPlayerId: null,
    wildDrawFourWasLegal: false,
    pendingOutPlayerId: null,
    declaredPlayerId: null,
    undeclaredPlayerId: null,
    drawnPlayerId: null,
    drawnCard: NO_CARD,
    roundWinner: null,
    dealer: playerIds.at(-1),
    roundNumber: 0,
    roundPoints: 0,
  };
  startRound(state, random);
  return state;
}

function startRound(state, random) {
  state.hands = state.playerIds.map(() => Array(CARD_TYPES).fill(0));
  state.drawPile = buildDeck();
  state.discardPile = [];
  state.phase = PHASES.ACTIVE;
  state.winner = null;
  state.currentColor = null;
  state.direction = 0;
  state.pendingPenalty = 0;
  state.challengePlayerId = null;
  state.wildDrawFourPlayerId = null;
  state.wildDrawFourWasLegal = false;
  state.pendingOutPlayerId = null;
  state.declaredPlayerId = null;
  state.undeclaredPlayerId = null;
  state.drawnPlayerId = null;
  state.drawnCard = NO_CARD;
  state.roundWinner = null;
  state.roundPoints = 0;
  if (state.roundNumber !== 0) state.dealer = advance(state, state.dealer);
  state.roundNumber = Math.min(0xff, state.roundNumber + 1);

  shuffle(state.drawPile, random);
  for (let dealt = 0; dealt < CARDS_PER_HAND; dealt += 1) {
    for (const playerId of state.playerIds) drawOne(state, playerId, random);
  }
  state.currentTurn = advance(state, state.dealer);

  let topIndex = state.drawPile.length - 1;
  while (topIndex > 0 && state.drawPile[topIndex] === WILD_DRAW_FOUR) topIndex -= 1;
  const lastIndex = state.drawPile.length - 1;
  [state.drawPile[lastIndex], state.drawPile[topIndex]] = [
    state.drawPile[topIndex],
    state.drawPile[lastIndex],
  ];
  const top = state.drawPile.pop();
  state.discardPile.push(top);

  if (top === WILD) {
    state.currentColor = null;
    return;
  }
  state.currentColor = cardColor(top);
  const rank = cardRank(top);
  if (rank === RANKS.SKIP) {
    state.currentTurn = advance(state, state.currentTurn);
  } else if (rank === RANKS.REVERSE) {
    state.direction = 1;
    state.currentTurn = state.dealer;
  } else if (rank === RANKS.DRAW_TWO) {
    const penalized = state.currentTurn;
    drawCards(state, penalized, 2, random);
    state.currentTurn = advance(state, penalized);
  }
}

function buildDeck() {
  const deck = [];
  for (let color = COLORS.RED; color <= COLORS.BLUE; color += 1) {
    deck.push(color * 13 + RANKS.ZERO);
    for (let rank = RANKS.ONE; rank <= RANKS.DRAW_TWO; rank += 1) {
      const card = color * 13 + rank;
      deck.push(card, card);
    }
  }
  for (let index = 0; index < 4; index += 1) deck.push(WILD, WILD_DRAW_FOUR);
  return deck;
}

function shuffle(cards, random) {
  for (let index = cards.length; index > 1; index -= 1) {
    const swapIndex = random.nextInt(index);
    [cards[index - 1], cards[swapIndex]] = [cards[swapIndex], cards[index - 1]];
  }
}

function replenishDrawPile(state, random) {
  if (state.drawPile.length !== 0) return true;
  if (state.discardPile.length <= 1) return false;
  const top = state.discardPile.pop();
  state.drawPile = state.discardPile;
  state.discardPile = [top];
  shuffle(state.drawPile, random);
  return true;
}

function drawOne(state, actor, random) {
  if (!replenishDrawPile(state, random)) return NO_CARD;
  const card = state.drawPile.pop();
  state.hands[state.playerIds.indexOf(actor)][card] += 1;
  return card;
}

function drawCards(state, actor, count, random) {
  for (let index = 0; index < count; index += 1) {
    if (drawOne(state, actor, random) === NO_CARD) return;
  }
}

function hasColor(state, actor, color) {
  const hand = state.hands[state.playerIds.indexOf(actor)];
  const first = color * 13;
  for (let card = first; card < first + 13; card += 1) {
    if (hand[card] !== 0) return true;
  }
  return false;
}

function closeDeclarationWindow(state) {
  state.undeclaredPlayerId = null;
}

function advance(state, actor, steps = 1) {
  let index = state.playerIds.indexOf(actor);
  if (index < 0) throw new Error('Cannot advance an unknown Color Match player');
  for (let step = 0; step < steps; step += 1) {
    index += state.direction === 0 ? 1 : -1;
    if (index < 0) index = state.playerIds.length - 1;
    if (index >= state.playerIds.length) index = 0;
  }
  return state.playerIds[index];
}

export function validCard(card) {
  return Number.isInteger(card) && card >= 0 && card < CARD_TYPES;
}

export function validColor(color) {
  return Number.isInteger(color) && color >= COLORS.RED && color <= COLORS.BLUE;
}

export function cardColor(card) {
  return card < WILD ? Math.floor(card / 13) : NO_CARD;
}

export function cardRank(card) {
  return card < WILD ? card % 13 : card;
}

export function handSize(state, actor) {
  const index = state.playerIds.indexOf(actor);
  if (index < 0) return 0;
  return state.hands[index].reduce((total, count) => total + count, 0);
}

export function handScore(state, actor) {
  const index = state.playerIds.indexOf(actor);
  if (index < 0) return 0;
  let score = 0;
  for (let card = 0; card < CARD_TYPES; card += 1) {
    const count = state.hands[index][card];
    if (count === 0) continue;
    const rank = cardRank(card);
    const value = card >= WILD ? 50 : rank <= RANKS.NINE ? rank : 20;
    score += value * count;
  }
  return score;
}

export function cardIsPlayable(state, card) {
  if (!validCard(card)) return false;
  if (card >= WILD) return true;
  if (state.currentColor === null) return false;
  if (cardColor(card) === state.currentColor) return true;
  const top = state.discardPile.at(-1);
  return top < WILD && cardRank(card) === cardRank(top);
}

export function createControlledState(playerCount = 2) {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 8) {
    throw new Error('Controlled Color Match state requires 2-8 players');
  }
  const playerIds = Array.from({ length: playerCount }, (_, index) => `player-${index + 1}`);
  return {
    playerIds,
    hands: playerIds.map(() => Array(CARD_TYPES).fill(0)),
    drawPile: Array.from({ length: 20 }, (_, index) => 13 + (index % 10)),
    discardPile: [5],
    scores: playerIds.map(() => 0),
    rematchVotes: playerIds.map(() => false),
    phase: PHASES.ACTIVE,
    currentTurn: playerIds[0],
    winner: null,
    currentColor: COLORS.RED,
    direction: 0,
    pendingPenalty: 0,
    challengePlayerId: null,
    wildDrawFourPlayerId: null,
    wildDrawFourWasLegal: false,
    pendingOutPlayerId: null,
    declaredPlayerId: null,
    undeclaredPlayerId: null,
    drawnPlayerId: null,
    drawnCard: NO_CARD,
    roundWinner: null,
    dealer: playerIds.at(-1),
    roundNumber: 1,
    roundPoints: 0,
  };
}

export function seededRandom(seed) {
  let state = (seed >>> 0) || 0x6d2b79f5;
  return Object.freeze({
    nextFloat() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
    },
    nextInt(maximum) {
      if (!Number.isInteger(maximum) || maximum <= 0) {
        throw new Error('Random integer maximum must be positive');
      }
      return Math.floor(this.nextFloat() * maximum);
    },
  });
}

function requireRandom(random) {
  if (!random || typeof random.nextFloat !== 'function' || typeof random.nextInt !== 'function') {
    throw new Error('Color Match requires the deterministic host random source');
  }
  return random;
}

function validatePlayers(players) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 8) {
    throw new Error('Color Match requires 2-8 players');
  }
  const ids = new Set();
  for (const player of players) {
    if (!isRecord(player) || typeof player.id !== 'string' || player.id.length === 0) {
      throw new Error('Color Match player IDs must be non-empty strings');
    }
    if (ids.has(player.id)) throw new Error('Color Match player IDs must be unique');
    ids.add(player.id);
  }
}

function requireFiniteState(state) {
  return state;
}

function cloneState(state) {
  requireFiniteState(state);
  return {
    ...state,
    playerIds: [...state.playerIds],
    hands: state.hands.map((hand) => [...hand]),
    drawPile: [...state.drawPile],
    discardPile: [...state.discardPile],
    scores: [...state.scores],
    rematchVotes: [...state.rematchVotes],
  };
}

function accepted(state, events = []) {
  return { accepted: true, state, events };
}

function rejected(code, reason) {
  return { accepted: false, code, reason };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
