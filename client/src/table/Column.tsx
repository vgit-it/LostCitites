// One expedition column. Presentational only: takes cards and a direction,
// renders the overlapping stack. Knows nothing about whose column it is.

import { Card as CardModel, Colour } from '@shared/types';
import { Card, CardSlot } from '../shared/Card';

export interface ColumnProps {
  colour: Colour;
  cards: CardModel[];
  /** Seat 1's columns grow upward from the centre, seat 0's grow downward. */
  direction: 'up' | 'down';
}

export function Column({ colour, cards, direction }: ColumnProps) {
  if (cards.length === 0) {
    return (
      <div className={`column column--${direction}`}>
        <CardSlot colour={colour} size="md" label={`${colour} not started`} />
      </div>
    );
  }

  // Cards are appended in play order; drawing them in reverse for an upward
  // column keeps the most recent card nearest the centre of the table.
  const ordered = direction === 'up' ? [...cards].reverse() : cards;

  return (
    <div className={`column column--${direction}`} aria-label={`${colour} expedition`}>
      {ordered.map((card) => (
        <div className="column__card" key={card.id}>
          <Card card={card} size="md" />
        </div>
      ))}
    </div>
  );
}
