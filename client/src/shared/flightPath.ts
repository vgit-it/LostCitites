// Where a card goes when it leaves a screen, and where it comes from when it
// arrives on one.
//
// Pure — no DOM, no measurement. Both devices need the same arithmetic and
// neither should be doing it inline: a card thrown off the right of a phone
// and a card arriving over the bottom of a tablet are the same journey read
// in opposite directions, which is exactly what makes this one function.

import { edgeOfSeat as seatEdge } from './seating';

/** Just the parts of a DOMRect a flight needs, so tests can build one. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Which way is off. On a table, 'bottom' is seat 0 and 'top' is seat 1. */
export type Edge = 'top' | 'bottom' | 'left' | 'right';

/**
 * Clear of the edge, not merely touching it: a card that stops flush with the
 * boundary is still half-visible while it fades, which reads as the animation
 * giving up rather than the card leaving.
 */
const OVERSHOOT = 0.6;

/**
 * A card's position just past `edge`, keeping its size and its other axis.
 *
 * Used both ways round. As a flight's `to` it is a throw off the screen; as
 * its `from` it is an arrival, with the on-screen rect passed in as the card's
 * resting place either way.
 */
export function edgeRect(rect: Rect, edge: Edge, viewport: Viewport): Rect {
  switch (edge) {
    case 'left':
      return { ...rect, x: -rect.width * (1 + OVERSHOOT) };
    case 'right':
      return { ...rect, x: viewport.width + rect.width * OVERSHOOT };
    case 'top':
      return { ...rect, y: -rect.height * (1 + OVERSHOOT) };
    case 'bottom':
      return { ...rect, y: viewport.height + rect.height * OVERSHOOT };
  }
}

/** The edge a seat sits at. Seat 0 reads the table from the bottom. */
export function edgeOfSeat(seat: 0 | 1): Edge {
  return seatEdge(seat);
}

/**
 * The centre of a rect, which is what a throw is aimed at and what an arriving
 * card is aimed from.
 */
export function centreOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
