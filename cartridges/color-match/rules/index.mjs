import {
  createColorMatch,
  playerTimedOutColorMatch,
  reduceColorMatch,
  viewColorMatch,
} from './color-match-engine.mjs';

export function create(input) {
  return createColorMatch(input);
}

export function reduce(input) {
  return reduceColorMatch(input);
}

export function view(input) {
  return viewColorMatch(input);
}

// Color Match cannot remove a fixed seat without exposing or redistributing its hand.
// The safe API 1 policy is therefore to end a Wave match on a 45-second seat
// timeout. Local pass-and-play never invokes this hook.
export function playerTimedOut(input) {
  return playerTimedOutColorMatch(input);
}
