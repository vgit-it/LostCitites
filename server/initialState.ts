// ============================================================
// Construction of a fresh lobby-stage GameState.
//
// rules.ts owns `dealRound` but has no notion of "before any deal",
// and it is frozen — so the lobby state is built here. Pure: no I/O,
// no sockets, no dependency on rooms. Both server/room.ts and
// scripts/headlessGame.ts start from this.
// ============================================================

import { COLOURS, Card, Colour, GameState, PlayerState, Seat } from '@shared/types';

/** Fresh `{ yellow: [], blue: [], ... }`. Used for both expeditions and discards. */
export function emptyColourMap(): Record<Colour, Card[]> {
  const out = {} as Record<Colour, Card[]>;
  for (const colour of COLOURS) out[colour] = [];
  return out;
}

function createPlayer(seat: Seat, name: string): PlayerState {
  return {
    seat,
    name,
    connected: false,
    hand: [],
    expeditions: emptyColourMap(),
    roundScores: [],
  };
}

/**
 * A match that has not been dealt yet: round 1, stage 'lobby', empty hands.
 * `dealRound` (rules.ts) takes it from here once both seats are filled.
 */
export function createInitialState(
  names: [string, string] = ['Seat 1', 'Seat 2'],
): GameState {
  return {
    round: 1,
    stage: 'lobby',
    deck: [],
    discards: emptyColourMap(),
    players: [createPlayer(0, names[0]), createPlayer(1, names[1])],
    turn: 0,
    phase: 'place',
    blockedDrawCardId: null,
    readyForNextRound: [false, false],
  };
}
