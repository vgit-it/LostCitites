// Covers the "Rules" section of the BUILD_SPEC §15 testing checklist,
// plus its four published reference scores.

import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  applyDraw,
  applyPlace,
  buildDeck,
  canPlaceOnExpedition,
  dealRound,
  legalDrawSourcesFor,
  scoreExpedition,
  validatePlace,
} from './rules';
import { Card, CardValue, Colour, GameState, HAND_SIZE } from './types';
import { mulberry32 } from '../server/rng';
import { createInitialState } from '../server/initialState';

const num = (colour: Colour, v: number): Card => ({
  id: `${colour}-${v}`,
  colour,
  value: v as CardValue,
});
const wager = (colour: Colour, n: number): Card => ({
  id: `${colour}-w${n}`,
  colour,
  value: 'wager',
});

function playingState(): GameState {
  const state = createInitialState();
  dealRound(state, 0, mulberry32(1));
  return state;
}

describe('deck', () => {
  const deck = buildDeck();

  it('is exactly 60 cards', () => {
    expect(deck).toHaveLength(60);
  });

  it('has 60 unique ids', () => {
    expect(new Set(deck.map((c) => c.id)).size).toBe(60);
  });

  it('has 15 wagers, 3 per colour', () => {
    expect(deck.filter((c) => c.value === 'wager')).toHaveLength(15);
  });

  it('has no 1 card — numbers run 2..10', () => {
    const values = deck.filter((c) => c.value !== 'wager').map((c) => c.value as number);
    expect(Math.min(...values)).toBe(2);
    expect(Math.max(...values)).toBe(10);
  });
});

describe('scoring', () => {
  it('scores an untouched colour 0, not -20', () => {
    expect(scoreExpedition([])).toBe(0);
  });

  it('scores a single 2 as -18', () => {
    expect(scoreExpedition([num('blue', 2)])).toBe(-18);
  });

  it('multiplies losses as well as gains', () => {
    const bare = [num('red', 2), num('red', 3)];
    expect(scoreExpedition(bare)).toBe(-15);
    // One wager doubles the damage, it does not soften it.
    expect(scoreExpedition([wager('red', 1), ...bare])).toBe(-30);
  });

  it('scores a wager-only column as (0-20) x multiplier', () => {
    expect(scoreExpedition([wager('green', 1)])).toBe(-40);
    expect(scoreExpedition([wager('green', 1), wager('green', 2)])).toBe(-60);
  });

  it('counts wagers toward the 8-card bonus threshold', () => {
    // 2 wagers + 6 numbers = 8 cards, so the bonus applies.
    const column = [
      wager('white', 1),
      wager('white', 2),
      num('white', 2),
      num('white', 3),
      num('white', 4),
      num('white', 5),
      num('white', 6),
      num('white', 7),
    ];
    expect(column).toHaveLength(8);
    expect(scoreExpedition(column)).toBe(41); // (27-20)*3 + 20
  });

  it('adds the bonus after the multiplier, never inside it', () => {
    const column = [
      wager('yellow', 1),
      wager('yellow', 2),
      wager('yellow', 3),
      ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => num('yellow', v)),
    ];
    // (54-20)*4 + 20 = 156.  Multiplying the bonus too would give 216.
    expect(scoreExpedition(column)).toBe(156);
  });

  it('withholds the bonus below 8 cards', () => {
    const seven = [2, 3, 4, 5, 6, 7, 8].map((v) => num('green', v));
    expect(seven).toHaveLength(7);
    expect(scoreExpedition(seven)).toBe(15); // 35-20, no bonus
  });
});

describe('placement legality', () => {
  it('rejects a wager once a number card is in the column', () => {
    const column = [num('blue', 4)];
    expect(canPlaceOnExpedition(column, wager('blue', 1)).ok).toBe(false);
  });

  it('allows stacked wagers while the column has no numbers', () => {
    expect(canPlaceOnExpedition([wager('blue', 1)], wager('blue', 2)).ok).toBe(true);
  });

  it('rejects an equal or lower number', () => {
    const column = [num('blue', 7)];
    expect(canPlaceOnExpedition(column, num('blue', 7)).ok).toBe(false);
    expect(canPlaceOnExpedition(column, num('blue', 4)).ok).toBe(false);
    expect(canPlaceOnExpedition(column, num('blue', 8)).ok).toBe(true);
  });

  it('routes a placed card to its own colour column, never another', () => {
    const state = playingState();
    const card = state.players[0].hand[0];
    applyPlace(state, 0, card.id, 'expedition');

    expect(state.players[0].expeditions[card.colour]).toContain(card);
    for (const other of Object.keys(state.players[0].expeditions) as Colour[]) {
      if (other !== card.colour) expect(state.players[0].expeditions[other]).toHaveLength(0);
    }
  });

  it('rejects a card that is not in the placing seat’s hand', () => {
    const state = playingState();
    expect(validatePlace(state, 0, 'no-such-card', 'discard').ok).toBe(false);
  });
});

describe('turn and round flow', () => {
  it('deals 8 cards each and leaves 44 in the draw pile', () => {
    const state = playingState();
    expect(state.players[0].hand).toHaveLength(HAND_SIZE);
    expect(state.players[1].hand).toHaveLength(HAND_SIZE);
    expect(state.deck).toHaveLength(44);
  });

  it('blocks re-drawing the card just discarded, but not other piles', () => {
    const state = playingState();
    const card = state.players[0].hand[0];
    applyPlace(state, 0, card.id, 'discard');

    expect(state.blockedDrawCardId).toBe(card.id);
    const sources = legalDrawSourcesFor(state, 0);
    expect(sources).not.toContainEqual({ kind: 'discard', colour: card.colour });
    expect(sources).toContainEqual({ kind: 'deck' });
  });

  it('clears the block when the card is placed on an expedition instead', () => {
    const state = playingState();
    const card = state.players[0].hand[0];
    applyPlace(state, 0, card.id, 'expedition');
    expect(state.blockedDrawCardId).toBeNull();
  });

  it('passes the turn to the opponent after a draw', () => {
    const state = playingState();
    applyPlace(state, 0, state.players[0].hand[0].id, 'discard');
    applyDraw(state, 0, { kind: 'deck' });

    expect(state.turn).toBe(1);
    expect(state.phase).toBe('place');
  });

  it('ends the round immediately on the last deck draw, with no extra turn', () => {
    const state = playingState();
    state.deck = [num('red', 10)];

    applyPlace(state, 0, state.players[0].hand[0].id, 'discard');
    const drawn = applyDraw(state, 0, { kind: 'deck' });

    expect(state.stage).toBe('roundEnd');
    expect(state.deck).toHaveLength(0);
    // The drawing player keeps the card...
    expect(state.players[0].hand).toContain(drawn);
    // ...and the opponent gets no compensating turn.
    expect(state.turn).toBe(0);
    expect(state.players[0].roundScores).toHaveLength(1);
    expect(state.players[1].roundScores).toHaveLength(1);
  });

  it('goes to matchEnd rather than roundEnd after round 3', () => {
    const state = playingState();
    state.round = 3;
    state.deck = [num('red', 10)];

    applyPlace(state, 0, state.players[0].hand[0].id, 'discard');
    applyDraw(state, 0, { kind: 'deck' });

    expect(state.stage).toBe('matchEnd');
  });

  it('gives the next round to the higher scorer of the round just played', () => {
    const state = playingState();
    state.stage = 'roundEnd';
    state.players[0].roundScores = [-10];
    state.players[1].roundScores = [20];

    advanceRound(state, mulberry32(2));

    expect(state.turn).toBe(1);
    expect(state.round).toBe(2);
    expect(state.stage).toBe('playing');
  });

  it('keeps the previous leader on a tied round', () => {
    const state = playingState();
    state.stage = 'roundEnd';
    state.turn = 1;
    state.players[0].roundScores = [7];
    state.players[1].roundScores = [7];

    advanceRound(state, mulberry32(3));

    expect(state.turn).toBe(1);
  });
});
