// One expedition column. Presentational only: takes cards and a direction,
// renders the overlapping stack. Knows nothing about whose column it is.

import { Card as CardModel, Colour } from '@shared/types';
import { Card, CardSlot } from '../shared/Card';
import { ElevationProfile } from './ElevationProfile';

export interface ColumnProps {
  colour: Colour;
  cards: CardModel[];
  /** Seat 1's columns grow upward from the centre, seat 0's grow downward. */
  direction: 'up' | 'down';
}

export function Column({ colour, cards, direction }: ColumnProps) {
  if (cards.length === 0) {
    return (
      <div className={`column column--${direction}`} style={{ '--n': 1 } as React.CSSProperties}>
        <CardSlot colour={colour} size="md" label={`${colour} not started`} />
      </div>
    );
  }

  // Cards are appended in play order; drawing them in reverse for an upward
  // column keeps the most recent card nearest the centre of the table.
  const ordered = direction === 'up' ? [...cards].reverse() : cards;

  return (
    <div
      className={`column column--${direction}`}
      // The card count is the divisor the CSS needs to clamp the stair's
      // horizontal step against the cell it actually got.
      style={{ '--n': cards.length } as React.CSSProperties}
      aria-label={`${colour} expedition`}
    >
      <ElevationProfile cards={cards} colour={colour} direction={direction} />
      {ordered.map((card, i) => (
        <div
          className="column__card"
          key={card.id}
          // Indexed by play order, not render order, so the stair runs the
          // same way for both players even though one column grows upward.
          style={{ '--i': direction === 'up' ? ordered.length - 1 - i : i } as React.CSSProperties}
        >
          <Card card={card} size="md" />
        </div>
      ))}
    </div>
  );
}
