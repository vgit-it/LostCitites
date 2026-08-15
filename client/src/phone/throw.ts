// What letting go of a carried card meant, on the phone.
//
// Pure. The carrying itself is shared/carry.ts; this is the half that knows
// what the two directions are for, which is the phone's business alone.

import { PlaceTarget } from '@shared/types';
import { FLICK_V } from '../shared/carry';

/** px. A shove: slow, but far enough that it cannot be a mis-tap. */
export const THROW_DX = 88;

export type Throw = PlaceTarget['kind'] | 'refuse' | 'return';

export interface Release {
  /** Horizontal distance from where the card was picked up. */
  dx: number;
  /** Horizontal speed at the moment of release, px/ms. */
  vx: number;
  /** From the view. The phone does no legality work of its own. */
  legalTargets: PlaceTarget['kind'][];
}

/**
 * Right plays the card to its own expedition, left discards it. There is no
 * target to choose: a card has exactly one colour, so the direction is the
 * whole decision.
 *
 * Either a flick or a shove commits, so a quick throw and a slow deliberate
 * push both work — one threshold alone always strands one of the two hands
 * that play this game.
 */
export function flickOutcome({ dx, vx, legalTargets }: Release): Throw {
  const flicked = Math.abs(vx) >= FLICK_V;
  if (!flicked && Math.abs(dx) < THROW_DX) return 'return';

  // When speed and distance disagree — dragged left, flicked back right — the
  // speed wins. The last thing the hand did is the intent.
  const rightward = flicked ? vx > 0 : dx > 0;
  const target: PlaceTarget['kind'] = rightward ? 'expedition' : 'discard';

  return legalTargets.includes(target) ? target : 'refuse';
}

/**
 * Which side is armed mid-carry, for the highlight under the card.
 * Deliberately a lower bar than committing: the wash should light up well
 * before the throw would land, so the player learns the gesture by seeing it
 * arm.
 */
export const ARM_DX = 24;

export function armedSide(dx: number): PlaceTarget['kind'] | null {
  if (Math.abs(dx) < ARM_DX) return null;
  return dx > 0 ? 'expedition' : 'discard';
}
