// The one place that knows which physical edge of the table a seat sits at.
//
// Three call sites used to each hardcode this mapping on their own —
// `edgeOfSeat` (flightPath.ts), `towardSeat` (drawGesture.ts), and a literal
// `flipped` / `flipped={false}` pair in Table.tsx. All three were saying the
// same thing about the same two seats; this is that thing, said once, so a
// fourth and fifth consumer (the column stair, the shared centre strip) have
// somewhere to ask instead of adding a sixth copy.

import { Seat } from '@shared/types';

/** Seat 0 sits at the table's bottom edge, seat 1 at the top. */
export function edgeOfSeat(seat: Seat): 'top' | 'bottom' {
  return seat === 0 ? 'bottom' : 'top';
}

/**
 * True for the seat sitting at the top edge — the one everything on the
 * table has to turn 180° to face, since the table itself reads bottom-up.
 */
export function isFlipped(seat: Seat): boolean {
  return edgeOfSeat(seat) === 'top';
}
