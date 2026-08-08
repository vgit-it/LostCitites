// ============================================================
// The signature element (BUILD_SPEC §9): a thin stepped line down each
// column's edge whose displacement maps to the card values played.
//
// A strong ascending expedition draws a rising ridge; a stalled one shows a
// flat stub. From across the table you read the shape before the numbers.
//
// This is the one idea, spent in one place. Kept in its own file so it can
// be tuned or dropped without touching column layout.
// ============================================================

import { Card, Colour } from '@shared/types';

const MIN_VALUE = 2;
const MAX_VALUE = 10;

/** Wagers carry no value, so they sit on the baseline — a flat opening. */
function displacement(card: Card): number {
  if (card.value === 'wager') return 0;
  return ((card.value as number) - MIN_VALUE) / (MAX_VALUE - MIN_VALUE);
}

export interface ElevationProfileProps {
  cards: Card[];
  colour: Colour;
  /** Seat 1's columns grow upward, so their profile runs the other way. */
  direction: 'up' | 'down';
}

/** The stepped path, in a 0..1 unit box. Exported for testing. */
export function profilePoints(cards: Card[], direction: 'up' | 'down'): string {
  const steps = cards.map(displacement);
  const span = steps.length;

  const points = steps.flatMap((x, index) => {
    const start = index / span;
    const end = (index + 1) / span;
    const [y0, y1] = direction === 'up' ? [1 - start, 1 - end] : [start, end];
    // Two points per card: the step across, then the run along it.
    return [`${x.toFixed(3)},${y0.toFixed(3)}`, `${x.toFixed(3)},${y1.toFixed(3)}`];
  });

  return points.join(' ');
}

export function ElevationProfile({ cards, colour, direction }: ElevationProfileProps) {
  // A single card is a stub, not a profile — nothing to read yet.
  if (cards.length < 2) return null;

  return (
    <svg
      className="elevation"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <polyline
        points={profilePoints(cards, direction)}
        fill="none"
        stroke={`var(--colour-${colour})`}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
