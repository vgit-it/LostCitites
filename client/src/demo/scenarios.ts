// ============================================================
// Starting positions for the demo.
//
// A scenario is a seed and a *predicate*, never a hand-built GameState.
// Bots play both seats through the ordinary protocol until the predicate
// holds, then hand over. Nothing here reaches into Room, and no server API
// exists for its benefit — which is what keeps a scenario a real position
// the game can actually be in, rather than a fixture that drifts.
//
// State is therefore a pure function of (scenario, seed), so a URL
// reproduces a screen exactly. That is what turns "it looks wrong here"
// into something reportable.
// ============================================================

import { PlayerView, Seat } from '@shared/types';
import { mulberry32 } from '../../../server/rng';
import { Bot, createBot, pump } from './bot';
import { createHub, DemoHub } from './hub';

export interface Scenario {
  id: string;
  label: string;
  /** Shown under the picker, so a tester knows what they are looking at. */
  blurb: string;
  /**
   * Stop as soon as this holds, reading seat 0's view. Omitted means the
   * round is never dealt at all.
   */
  until?: (view: PlayerView, steps: number) => boolean;
}

/**
 * Note on hand sizes: a hand is refilled to 8 on every draw, and the round
 * ends the moment the deck empties, so in real play a hand is only ever 8
 * (between turns) or 7 (mid-turn, after placing). There is no legal
 * position with a small hand, which is why no scenario claims to produce
 * one — `midturn` is the 7-card fan, and that is the smallest that exists.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'lobby',
    label: 'Lobby',
    blurb: 'Before the deal — the room code, the join screen, the seat lights.',
  },
  {
    id: 'fresh',
    label: 'Fresh deal',
    blurb: 'Eight cards, nothing played, seat 0 to place.',
    until: () => true,
  },
  {
    id: 'midturn',
    label: 'Mid-turn',
    blurb: 'Seat 0 has placed and must draw: the 7-card fan and the draw tray.',
    until: (view) => view.turn === 0 && view.phase === 'draw',
  },
  {
    id: 'blocked',
    label: 'Blocked draw',
    blurb: 'Seat 0 just discarded, so that pile is shut for this draw.',
    until: (view) =>
      view.turn === 0 && view.phase === 'draw' && view.blockedDrawCardId !== null,
  },
  {
    id: 'midround',
    label: 'Mid-round',
    blurb: 'Columns started and discards stocked, seat 0 to place.',
    until: (view, steps) => steps >= 24 && view.turn === 0 && view.phase === 'place',
  },
  {
    id: 'lateround',
    label: 'Deck nearly out',
    blurb: 'Four cards left — the deck counter at its "critical" styling.',
    until: (view) => view.deckCount <= 4 && view.turn === 0 && view.phase === 'place',
  },
  {
    id: 'roundend',
    label: 'Round scored',
    blurb: 'Round 1 over: the scoring screen and the ready gate.',
    until: (view) => view.stage === 'roundEnd',
  },
  {
    id: 'matchend',
    label: 'Match over',
    blurb: 'Three rounds played, final totals.',
    until: (view) => view.stage === 'matchEnd',
  },
];

export const DEFAULT_SCENARIO = 'midround';

export function findScenario(id: string | null): Scenario {
  return (
    SCENARIOS.find((scenario) => scenario.id === id) ??
    SCENARIOS.find((scenario) => scenario.id === DEFAULT_SCENARIO)!
  );
}

export interface StartOptions {
  scenario: Scenario;
  seed: number;
  /** Seats a person will take. Any other seat keeps its bot. */
  humanSeats: Seat[];
}

export interface DemoGame {
  hub: DemoHub;
  /** Bots still holding a seat once the humans have been given theirs. */
  bots: Bot[];
  /** How many half-turns the fast-forward played. */
  steps: number;
  /**
   * Whether the predicate actually held when the replay stopped.
   *
   * False means the bots ran out of moves first — the game overshot into a
   * position the scenario never asked for. Reported rather than thrown,
   * because a tester is better served by a playable game and a warning than
   * by a blank screen, but it is asserted in the tests so it cannot pass
   * unnoticed.
   */
  reached: boolean;
}

/**
 * Deals and fast-forwards to the scenario's position.
 *
 * Synchronous from end to end: the bots run on sync sockets, so the whole
 * replay lands before this returns and the UI mounts on a game that is
 * already in position — no loading state, no first paint of an empty lobby.
 */
export function startScenario({ scenario, seed, humanSeats }: StartOptions): DemoGame {
  const hub = createHub(seed);

  const bots: Bot[] = [0, 1].map((seat) =>
    createBot(hub.attach({ sync: true }), seat as Seat, mulberry32(seed + seat + 1), hub.code),
  );

  let steps = 0;
  let reached = true;
  if (scenario.until) {
    // Any joined connection may deal; the table is not required, and not
    // attaching one keeps the fast-forward to the two seats that matter.
    bots[0].send({ t: 'startRound' });

    const until = scenario.until;
    const result = pump(
      bots,
      (played) => {
        const view = bots[0].view();
        return view !== null && view.stage !== 'lobby' && until(view, played);
      },
      4000,
    );
    steps = result.steps;
    reached = result.reached;
  }

  // Hand over. Closing unbinds the seat, which marks it disconnected until
  // the real client joins and claims it a moment later.
  for (const seat of humanSeats) bots[seat].close();

  return {
    hub,
    bots: bots.filter((bot) => !humanSeats.includes(bot.seat)),
    steps,
    reached,
  };
}
