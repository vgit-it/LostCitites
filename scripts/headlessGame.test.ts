// Regression test for round/match transitions: a seeded match must always
// terminate at matchEnd with three recorded round scores per player.

import { describe, expect, it } from 'vitest';
import { playHeadlessGame } from './headlessGame';
import { totalScore } from '@shared/rules';

describe('headless match', () => {
  const seeds = [1, 42, 12345, 99999];

  it.each(seeds)('completes three rounds with seed %i', (seed) => {
    const state = playHeadlessGame(seed);

    expect(state.stage).toBe('matchEnd');
    expect(state.round).toBe(3);
    expect(state.deck).toHaveLength(0);

    for (const player of state.players) {
      expect(player.roundScores).toHaveLength(3);
      expect(totalScore(player)).toBe(player.roundScores.reduce((a, b) => a + b, 0));
    }
  });

  it('is deterministic for a given seed', () => {
    const a = playHeadlessGame(777);
    const b = playHeadlessGame(777);
    expect(a.players[0].roundScores).toEqual(b.players[0].roundScores);
    expect(a.players[1].roundScores).toEqual(b.players[1].roundScores);
  });
});
