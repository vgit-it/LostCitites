// The geometry of a fanned hand. Pure — no React, no DOM, no measurement.
//
// Extracted from Hand.tsx once the fan became something the player drags
// open rather than a fixed shape, so the arithmetic stays unit-testable the
// way profilePoints and views.ts are.

/** Percent of card height. ~28px at a 132px-tall card. */
export const LIFT_PCT = 21;
/** Percent of card height. An unplayable card sits back in the hand. */
export const SIT_BACK_PCT = 4;

const STEP_DEG = 4.5; // per-card tilt at rest — the "thickness" of the hand
const MAX_SPREAD_DEG = 34; // total at rest, so a full hand never curls into a claw
const GAP_W = 0.4; // neighbour spacing at rest, in card widths
const ASPECT = 1.5; // matches .card's aspect-ratio: 2 / 3

/**
 * Spread is a multiplier on the resting fan, not an absolute angle:
 * `spread === 1` reproduces the geometry the hand has always had, which is
 * what makes it the resting value and what keeps the exact-transform tests
 * meaningful.
 */
export const SPREAD_REST = 1;
export const SPREAD_MIN = 0.5; // squeezed into a thick stack
export const SPREAD_MAX = 1.9; // thrown wide open

/**
 * Where a hand starts, before anyone has fanned it — tighter than the
 * reference geometry, and deliberately.
 *
 * Spread is paid for in card width (see fanSpan), so a hand that starts
 * fully open starts with its cards at their smallest for no reason: nobody
 * has asked to see them separated yet. Resting closed makes the cards ~13%
 * bigger, and the whole point of the fan gesture is that opening them is now
 * a flick of the thumb away.
 */
export const SPREAD_INITIAL = 0.7;

/**
 * Pixels of horizontal drag that travel the full spread range. Deliberately
 * short: fanning is a flick of the thumb, not a haul across the screen.
 */
export const SPREAD_TRAVEL_PX = 180;

export function clampSpread(spread: number): number {
  return Math.min(SPREAD_MAX, Math.max(SPREAD_MIN, spread));
}

export interface FanSlot {
  /** Ready for the wrapper's inline style, in the resting state. */
  transform: string;
  /** Percent of card width, horizontal. Kept so states can recompose. */
  tx: number;
  /** Percent of card height, vertical. */
  ty: number;
  /** Kept separate so a lift or a flight can unwind the tilt back to level. */
  angle: number;
  zIndex: number;
}

/**
 * What a slot is doing. The three are mutually exclusive and the transform
 * is composed in JS rather than layered in CSS, because an inline transform
 * beats a stylesheet one — a CSS rule could not unwind the fan's tilt.
 */
export type SlotState = 'rest' | 'muted' | 'lifted';

/** A drag offset in pixels, applied on top of a slot's percentage placement. */
export interface Drag {
  x: number;
  y: number;
}

/**
 * Cards swung about a pivot below the wrist: middle highest, ends falling away.
 *
 * Percentages in a transform resolve against the element's own border box, so
 * this is a pure function of card count and spread — responsive by
 * construction, with no measurement and no ResizeObserver. Card width drives
 * the physical size; the geometry never changes.
 *
 * Opening the fan widens the tilt *and* the neighbour gap. Tilt alone would
 * rotate the cards without separating them, since the arc radius falls as the
 * step grows and holds the horizontal spacing constant — which is the one
 * thing fanning is supposed to change.
 */
export function fanLayout(n: number, spread: number = SPREAD_REST): FanSlot[] {
  if (n <= 0) return [];
  if (n === 1) {
    return [{ transform: 'translate(0.00%, 0.00%) rotate(0.00deg)', tx: 0, ty: 0, angle: 0, zIndex: 0 }];
  }

  const step = spread * Math.min(STEP_DEG, MAX_SPREAD_DEG / (n - 1));
  // Damped rather than proportional: at full spread the gap grows by ~40%,
  // not 90%, or a wide fan drives the cards small enough to stop being
  // readable once fanSpan trades width back for size.
  const gapW = GAP_W * (0.55 + 0.45 * spread);
  const half = (n - 1) / 2;
  const radiusW = gapW / ((step * Math.PI) / 180); // in card widths

  return Array.from({ length: n }, (_, i) => {
    const angle = (i - half) * step;
    const rad = (angle * Math.PI) / 180;
    const tx = radiusW * Math.sin(rad) * 100;
    const ty = ((radiusW * (1 - Math.cos(rad))) / ASPECT) * 100;
    return {
      transform: fanTransform(tx, ty, angle),
      tx,
      ty,
      angle,
      zIndex: i,
    };
  });
}

/**
 * How wide the fan is, in card widths, including the cards at either end.
 *
 * This is what lets the hand grow cards without ever overflowing: the width
 * budget is fixed by the viewport, so the CSS divides it by this number and
 * a wider fan simply yields smaller cards. Nothing in the app sets overflow,
 * and a clipped fan would be sheared rather than scrolled.
 */
export function fanSpan(n: number, spread: number = SPREAD_REST): number {
  return spanOf(fanLayout(n, spread));
}

/** The same measurement, for a layout already in hand. */
export function spanOf(slots: FanSlot[]): number {
  if (slots.length === 0) return 1;

  const txs = slots.map((s) => s.tx);
  const maxAngle = Math.max(...slots.map((s) => Math.abs(s.angle)));
  const rad = (maxAngle * Math.PI) / 180;
  // A tilted card's bounding box is wider than the card, by its height's
  // share of the rotation. Measuring centre-to-centre and adding one card
  // width understates the fan by exactly the outer cards' corners — which
  // is small enough to look right and still overflow the viewport.
  const endWidth = Math.cos(rad) + ASPECT * Math.sin(rad);

  return (Math.max(...txs) - Math.min(...txs)) / 100 + endWidth;
}

function fanTransform(tx: number, ty: number, angle: number): string {
  return `translate(${tx.toFixed(2)}%, ${ty.toFixed(2)}%) rotate(${angle.toFixed(2)}deg)`;
}

/**
 * The wrapper transform for a slot in a given state. Pure.
 *
 * `drag` is in pixels and the placement is in percentages, so they go in as
 * two separate translates and let the browser compose them — there is no
 * common unit to add them in, and calc() inside a transform would have to
 * know the card's pixel width.
 */
export function slotTransform(slot: FanSlot, state: SlotState, drag?: Drag): string {
  const shift = drag && (drag.x !== 0 || drag.y !== 0)
    ? ` translate(${drag.x.toFixed(1)}px, ${drag.y.toFixed(1)}px)`
    : '';

  switch (state) {
    // Out of the fan entirely: rises clear of its neighbours, levels off so
    // the face is square to the eye, and grows just enough to read as picked
    // up rather than nudged.
    case 'lifted':
      return `translate(${slot.tx.toFixed(2)}%, ${(-LIFT_PCT).toFixed(2)}%)${shift} rotate(0.00deg) scale(1.06)`;
    case 'muted':
      return fanTransform(slot.tx, slot.ty + SIT_BACK_PCT, slot.angle) + shift;
    default:
      return slot.transform + shift;
  }
}
