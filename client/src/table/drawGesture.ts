// Reaching across the table for a card.
//
// Pure. The one gesture the shared display accepts, and the reason it can
// accept any at all: BUILD_SPEC §7 kept the table input-free so that leaning
// on the tablet could not change the game. A tap would still have that
// problem. A deliberate pull *toward your own edge of the table*, during a
// draw phase, from a pile the server has marked legal, does not — an elbow
// does not pull toward a seat, and the wrong player's stray swipe goes the
// wrong way.

import { Seat } from '@shared/types';
import { FLICK_V } from '../shared/carry';
import { isFlipped } from '../shared/seating';

/**
 * px. How far a card must come toward you before letting go takes it.
 *
 * Short: this is a reach, not a throw. The card only has to visibly leave the
 * pile. The direction is doing most of the work of telling intent from
 * accident, so the distance does not have to be large as well.
 */
export const REACH_PX = 44;

export type DrawOutcome = 'take' | 'return';

export interface Reach {
  /** Vertical distance travelled since the press. Down is positive. */
  dy: number;
  /** Vertical speed at release, px/ms. */
  vy: number;
  /** Whose reach this is — the player to move. */
  seat: Seat;
}

/** +1 when this seat's own edge is below the board, −1 when it is above. */
export function towardSeat(seat: Seat): 1 | -1 {
  return isFlipped(seat) ? -1 : 1;
}

/**
 * Movement *toward* the acting seat commits; anything else puts the card
 * back. Distance or speed, the same pair the phone's throw uses, so a quick
 * flick and a slow deliberate pull both work.
 */
export function reachOutcome({ dy, vy, seat }: Reach): DrawOutcome {
  const toward = towardSeat(seat);
  const pulled = dy * toward;
  const speed = vy * toward;

  return speed >= FLICK_V || pulled >= REACH_PX ? 'take' : 'return';
}
