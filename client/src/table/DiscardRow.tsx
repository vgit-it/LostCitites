// The shared centre of the table: draw pile count plus the five discard tops.
// Read-only here — the table takes no input at all.

import { COLOURS, Card as CardModel, Colour } from '@shared/types';
import { Card, CardSlot } from '../shared/Card';

export interface DiscardRowProps {
  deckCount: number;
  discardTops: Record<Colour, CardModel | null>;
}

/** Amber below 10, red below 5 — the round is about to end. */
export function deckUrgency(deckCount: number): 'normal' | 'low' | 'critical' {
  if (deckCount < 5) return 'critical';
  if (deckCount < 10) return 'low';
  return 'normal';
}

export function DiscardRow({ deckCount, discardTops }: DiscardRowProps) {
  return (
    <div className="discard-row">
      <div className={`deck deck--${deckUrgency(deckCount)}`}>
        <span className="deck__count">{deckCount}</span>
        <span className="label">left</span>
      </div>

      <div className="discard-row__piles">
        {COLOURS.map((colour) => {
          const top = discardTops[colour];
          return (
            <div className="discard-row__pile" key={colour}>
              {top ? (
                <Card card={top} size="md" />
              ) : (
                <CardSlot colour={colour} size="md" label={`${colour} discard empty`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
