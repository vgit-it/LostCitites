// Turning the tablecloth over, by its folded-back corner.
//
// Pure, like drawGesture.ts, and safe on the shared display for the same
// reason: it is a deliberate directional pull, not a tap. The corner sits at
// the top-right of the table; only a pull diagonally in toward the middle of
// the table (left and down) lifts it, so an elbow resting on the edge or a
// swipe along it does nothing.

/** px along the diagonal before letting go turns the cloth over. */
export const PEEL_PX = 110;

/** px. The side of the folded corner at rest. */
export const FOLD_REST_PX = 44;

/**
 * How far the corner has been pulled, measured along the diagonal into the
 * table: left (negative dx) and down (positive dy) both count. A pull any
 * other way is zero rather than negative — the fold never goes past flat.
 */
export function peelDistance(dx: number, dy: number): number {
  return Math.max(0, (dy - dx) / Math.SQRT2);
}

/**
 * The folded corner's side while being pulled. Grows with the pull so the
 * fold visibly follows the finger: the fold line sits halfway between the
 * corner and the point it has been dragged to, as a real cloth's would.
 */
export function foldSize(distance: number): number {
  return FOLD_REST_PX + distance * Math.SQRT2 * 0.5;
}

export type PeelOutcome = 'turn' | 'return';

export function peelOutcome(distance: number): PeelOutcome {
  return distance >= PEEL_PX ? 'turn' : 'return';
}
