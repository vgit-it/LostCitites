// ============================================================
// State -> wire view. Pure: no I/O, no mutation, no knowledge of
// sockets, roles, or rooms.
//
// This is the only place hand leakage can happen, which is why it is a
// standalone pure function rather than something Room does inline —
// it can be asserted against with plain object checks.
// ============================================================

import { scorePlayer, legalDrawSourcesFor, legalPlacementsFor } from '@shared/rules';
import {
  BaseView,
  COLOURS,
  Card,
  Colour,
  GameState,
  PlayerState,
  PlayerView,
  PublicPlayerView,
  Seat,
  TableView,
} from '@shared/types';

/**
 * Views are copied out of the live state rather than sharing its arrays.
 * A recorded view must not mutate behind the recorder's back — this is what
 * lets tests capture a broadcast and compare it against a later one.
 */
function copyColumns(columns: Record<Colour, Card[]>): Record<Colour, Card[]> {
  const out = {} as Record<Colour, Card[]>;
  for (const colour of COLOURS) out[colour] = [...columns[colour]];
  return out;
}

function topsOf(discards: Record<Colour, Card[]>): Record<Colour, Card | null> {
  const out = {} as Record<Colour, Card | null>;
  for (const colour of COLOURS) {
    const pile = discards[colour];
    out[colour] = pile.length > 0 ? pile[pile.length - 1] : null;
  }
  return out;
}

/** Hand contents are reduced to a count here — this is what both sides see. */
function buildPublicPlayer(player: PlayerState): PublicPlayerView {
  return {
    seat: player.seat,
    name: player.name,
    connected: player.connected,
    handCount: player.hand.length,
    expeditions: copyColumns(player.expeditions),
    roundScores: [...player.roundScores],
    currentRoundScore: scorePlayer(player),
  };
}

function buildBaseView(state: GameState): BaseView {
  return {
    round: state.round,
    stage: state.stage,
    deckCount: state.deck.length,
    discardTops: topsOf(state.discards),
    turn: state.turn,
    phase: state.phase,
    players: [buildPublicPlayer(state.players[0]), buildPublicPlayer(state.players[1])],
    readyForNextRound: [state.readyForNextRound[0], state.readyForNextRound[1]],
  };
}

/**
 * No hands, no deck contents. Safe for the shared tablet.
 *
 * The draw sources are the player-to-move's, because the tablet's one
 * interactive gesture acts on that player's behalf. `legalDrawSourcesFor`
 * already returns nothing unless it is that seat's draw phase, so this needs
 * no stage guard of its own.
 */
export function buildTableView(state: GameState): TableView {
  return {
    viewer: 'table',
    ...buildBaseView(state),
    legalDrawSources: legalDrawSourcesFor(state, state.turn),
  };
}

/**
 * One seat's view: the base view plus that seat's own hand and its
 * precomputed legal moves, so the phone needs no rules logic.
 * Never contains the opponent's hand or the deck.
 */
export function buildPlayerView(state: GameState, seat: Seat): PlayerView {
  return {
    viewer: 'player',
    ...buildBaseView(state),
    seat,
    hand: [...state.players[seat].hand],
    legalPlacements: legalPlacementsFor(state, seat),
    legalDrawSources: legalDrawSourcesFor(state, seat),
    blockedDrawCardId: state.blockedDrawCardId,
  };
}

/** All three views for one broadcast. Base work is repeated but the state is tiny. */
export function buildViews(state: GameState): {
  table: TableView;
  seat0: PlayerView;
  seat1: PlayerView;
} {
  return {
    table: buildTableView(state),
    seat0: buildPlayerView(state, 0),
    seat1: buildPlayerView(state, 1),
  };
}
