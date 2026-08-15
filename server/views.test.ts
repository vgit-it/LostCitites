// The hand-leakage guarantees from BUILD_SPEC §15 "Protocol", asserted
// against plain objects with no sockets involved.

import { describe, expect, it } from 'vitest';
import { applyPlace, dealRound } from '@shared/rules';
import { GameState } from '@shared/types';
import { createInitialState } from './initialState';
import { mulberry32 } from './rng';
import { buildPlayerView, buildTableView } from './views';

function dealt(): GameState {
  const state = createInitialState(['Paul', 'Aditi']);
  state.players[0].connected = true;
  state.players[1].connected = true;
  dealRound(state, 0, mulberry32(9));
  return state;
}

describe('table view', () => {
  it('carries no hand arrays anywhere', () => {
    const view = buildTableView(dealt());
    expect(JSON.stringify(view)).not.toContain('"hand"');
  });

  it('carries no deck contents, only a count', () => {
    const state = dealt();
    const view = buildTableView(state);

    // The key, not the bare word: a draw source serializes as
    // {"kind":"deck"}, which is the pile's name and not its contents.
    expect(JSON.stringify(view)).not.toContain('"deck":');
    expect(view.deckCount).toBe(44);
  });

  it('offers no draw sources while someone is still placing', () => {
    expect(buildTableView(dealt()).legalDrawSources).toEqual([]);
  });

  it('offers the draw sources of the player to move, and only theirs', () => {
    const state = dealt();
    const card = state.players[0].hand[0];
    applyPlace(state, 0, card.id, 'discard');

    const view = buildTableView(state);
    expect(view.legalDrawSources).toEqual(buildPlayerView(state, 0).legalDrawSources);
    // The pile that card just went onto is the blocked one.
    expect(view.legalDrawSources).not.toContainEqual({ kind: 'discard', colour: card.colour });
  });

  it('reports hand sizes without revealing the cards', () => {
    const view = buildTableView(dealt());
    expect(view.players[0].handCount).toBe(8);
    expect(view.players[1].handCount).toBe(8);
  });

  it('shows only the top card of each discard pile', () => {
    const state = dealt();
    const first = state.players[0].hand[0];
    applyPlace(state, 0, first.id, 'discard');

    const view = buildTableView(state);
    expect(view.discardTops[first.colour]).toEqual(first);
    for (const colour of ['yellow', 'blue', 'white', 'green', 'red'] as const) {
      if (colour !== first.colour) expect(view.discardTops[colour]).toBeNull();
    }
  });
});

describe('player view', () => {
  it('carries its own hand and no opponent hand', () => {
    const state = dealt();
    const view = buildPlayerView(state, 0);

    expect(view.hand).toEqual(state.players[0].hand);
    // The opponent's cards must appear nowhere in the serialized view.
    const wire = JSON.stringify(view);
    for (const card of state.players[1].hand) {
      expect(wire).not.toContain(`"${card.id}"`);
    }
  });

  it('carries no deck contents', () => {
    const view = buildPlayerView(dealt(), 0);
    expect(JSON.stringify(view)).not.toContain('"deck"');
  });

  it('precomputes legal placements for the seat on turn', () => {
    const state = dealt();
    const view = buildPlayerView(state, 0);

    expect(Object.keys(view.legalPlacements)).toHaveLength(8);
    // Discard is always legal; expedition depends on the column.
    for (const targets of Object.values(view.legalPlacements)) {
      expect(targets).toContain('discard');
    }
  });

  it('offers no moves to the seat that is not on turn', () => {
    const view = buildPlayerView(dealt(), 1);
    expect(view.legalPlacements).toEqual({});
    expect(view.legalDrawSources).toEqual([]);
  });

  it('omits the just-discarded card and empty piles from draw sources', () => {
    const state = dealt();
    const discarded = state.players[0].hand[0];
    applyPlace(state, 0, discarded.id, 'discard');

    const view = buildPlayerView(state, 0);
    expect(view.blockedDrawCardId).toBe(discarded.id);
    expect(view.legalDrawSources).toContainEqual({ kind: 'deck' });
    // Its own pile is blocked, and every other pile is still empty.
    expect(view.legalDrawSources).toHaveLength(1);
  });
});

describe('view isolation', () => {
  it('copies columns so a recorded view does not mutate later', () => {
    const state = dealt();
    const before = buildTableView(state);
    const card = state.players[0].hand[0];

    applyPlace(state, 0, card.id, 'expedition');

    expect(before.players[0].expeditions[card.colour]).toHaveLength(0);
    expect(buildTableView(state).players[0].expeditions[card.colour]).toHaveLength(1);
  });
});
