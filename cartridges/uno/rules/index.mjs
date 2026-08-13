import {
  createUno,
  playerTimedOutUno,
  reduceUno,
  viewUno,
} from './uno-engine.mjs';

export function create(input) {
  return createUno(input);
}

export function reduce(input) {
  return reduceUno(input);
}

export function view(input) {
  return viewUno(input);
}

// UNO cannot remove a fixed seat without exposing or redistributing its hand.
// The safe API 1 policy is therefore to end a Wave match on a 45-second seat
// timeout. Local pass-and-play never invokes this hook.
export function playerTimedOut(input) {
  return playerTimedOutUno(input);
}
