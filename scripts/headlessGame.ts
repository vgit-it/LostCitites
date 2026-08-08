// ============================================================
// M2 — headless game loop.
//
// Plays a complete 3-round match with random legal moves, using nothing
// but the rules layer. No sockets, no UI. This is what proves the rules
// and the round/match transitions work before anything depends on them.
//
//   npm run headless            # random seed
//   npm run headless -- 12345   # replay a specific seed
// ============================================================

import {
  advanceRound,
  applyDraw,
  applyPlace,
  dealRound,
  legalDrawSourcesFor,
  legalPlacementsFor,
  matchWinner,
  scoreBreakdown,
  totalScore,
} from '@shared/rules';
import { COLOURS, GameState, Seat } from '@shared/types';
import { Rng, mulberry32 } from '../server/rng';
import { createInitialState } from '../server/initialState';

function pick<T>(items: T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)];
}

/** One place-then-draw turn for whoever is on turn. */
function playTurn(state: GameState, rng: Rng): void {
  const seat = state.turn;

  const placements = legalPlacementsFor(state, seat);
  const cardIds = Object.keys(placements);
  if (cardIds.length === 0) throw new Error(`seat ${seat} has no legal placement`);

  const cardId = pick(cardIds, rng);
  const target = pick(placements[cardId], rng);
  applyPlace(state, seat, cardId, target);

  const sources = legalDrawSourcesFor(state, seat);
  if (sources.length === 0) throw new Error(`seat ${seat} has no legal draw source`);
  applyDraw(state, seat, pick(sources, rng));
}

/**
 * Plays a full match to `stage === 'matchEnd'` and returns the final state.
 * Throws if the game stalls, which is the failure mode worth catching early.
 */
export function playHeadlessGame(seed: number, log = false): GameState {
  const rng = mulberry32(seed);
  const state = createInitialState(['Player A', 'Player B']);

  dealRound(state, 0, rng);

  // Generous ceiling: a round is at most ~44 turns, three rounds plus slack.
  let guard = 0;
  while (state.stage !== 'matchEnd') {
    if (++guard > 1000) throw new Error('game did not terminate');

    if (state.stage === 'playing') {
      playTurn(state, rng);
      continue;
    }

    if (state.stage === 'roundEnd') {
      if (log) reportRound(state);
      advanceRound(state, rng);
    }
  }

  if (log) {
    reportRound(state);
    reportMatch(state);
  }
  return state;
}

function reportRound(state: GameState): void {
  console.log(`\n── Round ${state.round} ─────────────────────────────`);
  for (const seat of [0, 1] as Seat[]) {
    const player = state.players[seat];
    const breakdown = scoreBreakdown(player);
    const cells = COLOURS.map((c) => `${c.padEnd(6)} ${String(breakdown[c]).padStart(4)}`);
    console.log(
      `  ${player.name.padEnd(9)} ${cells.join('  ')}   = ${player.roundScores[state.round - 1]}`,
    );
  }
}

function reportMatch(state: GameState): void {
  const winner = matchWinner(state);
  console.log('\n══ Match over ═══════════════════════════════');
  for (const seat of [0, 1] as Seat[]) {
    const player = state.players[seat];
    console.log(
      `  ${player.name.padEnd(9)} ${player.roundScores.join(' + ')} = ${totalScore(player)}`,
    );
  }
  console.log(
    winner === 'tie' ? '  Result: tie' : `  Winner: ${state.players[winner].name}`,
  );
}

// Run directly (not when imported by a test).
if (process.argv[1]?.endsWith('headlessGame.ts')) {
  const seed = Number(process.argv[2] ?? Date.now() % 2 ** 31);
  console.log(`seed: ${seed}`);
  playHeadlessGame(seed, true);
}
