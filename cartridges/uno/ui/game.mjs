import { WaveGames } from './wavegames-sdk.mjs';

const COLORS = ['red', 'yellow', 'green', 'blue'];
const COLOR_NAMES = ['Red', 'Yellow', 'Green', 'Blue'];
const RANK_NAMES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', 'Reverse', '+2'];
const WILD = 52;
const WILD_DRAW_FOUR = 53;

const elements = Object.fromEntries(
  [...document.querySelectorAll('[id]')].map((element) => [element.id, element]),
);
let latestView = null;
let roster = [];
let submitting = false;
let pendingWildCard = null;
let toastTimer = null;

for (const palette of document.querySelectorAll('.palette')) {
  for (let color = 0; color < COLORS.length; color += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `color-button ${COLORS[color]}`;
    button.dataset.color = String(color);
    button.dataset.purpose = palette.dataset.purpose;
    button.setAttribute('aria-label', COLOR_NAMES[color]);
    button.innerHTML = `<span></span>${COLOR_NAMES[color]}`;
    palette.append(button);
  }
}

const game = await WaveGames.connect({ api: 1 });
roster = game.context.roster ?? game.roster ?? [];
elements.seat.textContent = `Seat ${game.context.seat} · ${playerName(game.context.playerId)}`;
game.onRoster((nextRoster) => {
  roster = nextRoster;
  if (latestView) render(latestView);
});
game.onView(render);
game.onEvent(showEvent);
game.onStatus((status) => {
  if (status !== 'connected') elements.message.textContent = String(status);
});
if (game.view) render(game.view);

elements['draw-pile'].addEventListener('click', () => submit({ type: 'draw' }));
elements['call-uno'].addEventListener('click', () => submit({ type: 'callUno' }));
elements['catch-uno'].addEventListener('click', () => submit({ type: 'catchUno' }));
elements.pass.addEventListener('click', () => submit({ type: 'pass' }));
elements.challenge.addEventListener('click', () => submit({ type: 'challenge' }));
elements['accept-draw'].addEventListener('click', () => submit({ type: 'acceptDraw' }));
elements['next-round'].addEventListener('click', () => submit({ type: 'nextRound' }));
elements.rematch.addEventListener('click', () => submit({ type: 'rematch' }));
elements['cancel-color'].addEventListener('click', closeWildPicker);
elements['wild-picker'].addEventListener('click', (event) => {
  if (event.target === elements['wild-picker']) closeWildPicker();
});

for (const palette of document.querySelectorAll('.palette')) {
  palette.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-color]');
    if (!button || submitting) return;
    const color = Number(button.dataset.color);
    if (button.dataset.purpose === 'opening') {
      submit({ type: 'chooseColor', color });
      return;
    }
    if (pendingWildCard !== null) {
      const card = pendingWildCard;
      closeWildPicker();
      submit({ type: 'play', card, color });
    }
  });
}

function render(view) {
  latestView = view;
  renderPlayers(view);
  renderTable(view);
  renderHand(view);
  renderActions(view);
  renderMessage(view);
  elements.round.textContent = `Round ${view.roundNumber}`;
  elements.direction.textContent = view.direction === 0 ? '↻' : '↺';
  elements.direction.setAttribute(
    'aria-label',
    view.direction === 0 ? 'Clockwise' : 'Counterclockwise',
  );
}

function renderPlayers(view) {
  elements.players.replaceChildren();
  for (let index = 0; index < view.playerIds.length; index += 1) {
    const playerId = view.playerIds[index];
    const item = document.createElement('li');
    item.className = 'player-chip';
    item.classList.toggle('viewer', playerId === view.viewer);
    item.classList.toggle('current', playerId === view.currentTurn);
    item.classList.toggle('vulnerable', playerId === view.unoVulnerablePlayerId);
    const flags = [
      playerId === view.dealer ? '<span title="Dealer">D</span>' : '',
      playerId === view.unoVulnerablePlayerId ? '<span class="uno-flag">UNO?</span>' : '',
    ].join('');
    item.innerHTML = `
      <div class="player-name">${escapeText(playerName(playerId))}${flags}</div>
      <div class="player-stats"><b>${view.cardCounts[index]}</b> cards · <b>${view.scores[index]}</b> pts</div>
    `;
    elements.players.append(item);
  }
}

function renderTable(view) {
  elements.discard.replaceChildren(cardElement(view.topCard, { large: true }));
  elements['draw-count'].textContent = String(view.drawPileCount);
  elements['draw-pile'].disabled = submitting || !view.canDraw;
  elements['draw-pile'].classList.toggle('available', view.canDraw && !submitting);
  const color = view.currentColor;
  elements['active-color'].className = `color-dot ${color === null ? 'none' : COLORS[color]}`;
  elements['color-name'].textContent = color === null ? 'Choose color' : COLOR_NAMES[color];
}

function renderHand(view) {
  const legal = new Set(view.legalCards);
  elements.hand.replaceChildren();
  let count = 0;
  for (let card = 0; card < view.handCounts.length; card += 1) {
    for (let copy = 0; copy < view.handCounts[card]; copy += 1) {
      count += 1;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hand-card';
      button.disabled = submitting || !legal.has(card);
      button.setAttribute('aria-label', `Play ${cardName(card)}`);
      button.append(cardElement(card));
      if (view.drawnCard === card) button.classList.add('drawn');
      button.addEventListener('click', () => {
        if (card >= WILD) openWildPicker(card);
        else submit({ type: 'play', card });
      });
      elements.hand.append(button);
    }
  }
  elements['hand-count'].textContent = `${count} ${count === 1 ? 'card' : 'cards'}`;
}

function renderActions(view) {
  toggleAction('call-uno', view.canCallUno && !view.unoDeclared);
  toggleAction('catch-uno', view.canCatchUno);
  toggleAction('pass', view.canPass);
  toggleAction('challenge', view.canChallenge);
  toggleAction('accept-draw', view.canAcceptDraw);
  toggleAction('next-round', view.canStartNextRound);
  toggleAction('rematch', view.phase === 'finished');
  elements.rematch.disabled = submitting || !view.canRematch;
  const viewerIndex = view.playerIds.indexOf(view.viewer);
  elements.rematch.textContent = view.rematchVotes[viewerIndex]
    ? 'Waiting for players…'
    : 'Request rematch';
  elements['opening-colors'].hidden = !view.canChooseColor;
  for (const button of elements['opening-colors'].querySelectorAll('button')) {
    button.disabled = submitting;
  }
}

function renderMessage(view) {
  if (view.phase === 'finished') {
    elements.turn.textContent = view.winner === view.viewer ? 'You win the match!' : `${playerName(view.winner)} wins`;
    elements.message.textContent = `${playerName(view.winner)} reached ${view.scores[view.playerIds.indexOf(view.winner)]} points.`;
    return;
  }
  if (view.phase === 'roundFinished') {
    elements.turn.textContent = view.roundWinner === view.viewer ? 'Round won!' : 'Round complete';
    elements.message.textContent = `${playerName(view.roundWinner)} scored ${view.roundPoints} points.`;
    return;
  }
  if (view.canChooseColor) {
    elements.turn.textContent = 'Choose a color';
    elements.message.textContent = 'The opening card is Wild.';
  } else if (view.canChallenge) {
    elements.turn.textContent = 'Wild Draw Four';
    elements.message.textContent = 'Draw four, or challenge whether the previous player held the active color.';
  } else if (view.currentTurn === view.viewer) {
    elements.turn.textContent = view.canPass ? 'Play or pass' : 'Your turn';
    elements.message.textContent = view.drawnCard === null
      ? 'Play a highlighted card or draw one.'
      : 'Only the card you just drew may be played.';
  } else {
    elements.turn.textContent = `${playerName(view.currentTurn)}'s turn`;
    elements.message.textContent = view.unoVulnerablePlayerId
      ? `${playerName(view.unoVulnerablePlayerId)} missed UNO — catch them before play continues.`
      : 'Your opponents’ cards stay hidden.';
  }
}

async function submit(action) {
  if (submitting) return;
  submitting = true;
  if (latestView) render(latestView);
  try {
    const result = await game.sendAction(action);
    if (!result.accepted) showToast(result.reason ?? 'That action is not allowed', true);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), true);
  } finally {
    submitting = false;
    if (latestView) render(latestView);
  }
}

function cardElement(card, { large = false } = {}) {
  const element = document.createElement('span');
  const color = card >= WILD ? 'wild' : COLORS[Math.floor(card / 13)];
  element.className = `card ${color}${large ? ' large' : ''}`;
  element.innerHTML = `<i>${cardSymbol(card)}</i><b>${cardSymbol(card)}</b><i>${cardSymbol(card)}</i>`;
  element.title = cardName(card);
  return element;
}

function cardSymbol(card) {
  if (card === WILD) return 'W';
  if (card === WILD_DRAW_FOUR) return '+4';
  const rank = card % 13;
  if (rank === 10) return '⊘';
  if (rank === 11) return '⇄';
  if (rank === 12) return '+2';
  return String(rank);
}

function cardName(card) {
  if (card === WILD) return 'Wild';
  if (card === WILD_DRAW_FOUR) return 'Wild Draw Four';
  return `${COLOR_NAMES[Math.floor(card / 13)]} ${RANK_NAMES[card % 13]}`;
}

function openWildPicker(card) {
  pendingWildCard = card;
  elements['wild-picker'].hidden = false;
  elements['wild-picker'].querySelector('button').focus();
}

function closeWildPicker() {
  pendingWildCard = null;
  elements['wild-picker'].hidden = true;
}

function toggleAction(id, visible) {
  elements[id].hidden = !visible;
  elements[id].disabled = submitting;
}

function playerName(playerId) {
  if (playerId === null || playerId === undefined) return 'Nobody';
  return roster.find((player) => player.id === playerId)?.name
    ?? game?.context?.roster?.find((player) => player.id === playerId)?.name
    ?? playerId;
}

function showEvent(event) {
  if (!event || typeof event !== 'object') return;
  const text = {
    unoCalled: `${playerName(event.playerId)} called UNO!`,
    unoCaught: `${playerName(event.playerId)} was caught and drew two.`,
    challengeWon: `Challenge won — ${playerName(event.offender)} draws four.`,
    challengeLost: `Challenge lost — ${playerName(event.playerId)} draws six.`,
    roundWon: `${playerName(event.playerId)} wins ${event.points} points.`,
    matchWon: `${playerName(event.playerId)} wins the match!`,
  }[event.type];
  if (text) showToast(text);
}

function showToast(text, isError = false) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = text;
  elements.toast.classList.toggle('error', isError);
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 2800);
}

function escapeText(value) {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}
