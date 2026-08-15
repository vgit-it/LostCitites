// The two directions a carried card can be thrown, washed across the screen
// behind it.
//
// Not drop targets. Nothing here is hit-tested and nothing here is tappable —
// the decision is made from the direction and speed of the throw, in
// carry.ts, and these are only what tells the player which way is which.
// Hence aria-hidden: the accessible route is HandActions, not a wash.

import { Card as CardModel, PlaceTarget } from '@shared/types';
import { COLOUR_MARK } from '../shared/Card';
import { expeditionHint, placementWeight, throwLabel } from './columnRead';

export interface FlickZonesProps {
  card: CardModel;
  /** Precomputed by the server for this exact card. */
  targets: PlaceTarget['kind'][];
  /** The player's own column for this card's colour, for the label only. */
  column: CardModel[];
  /** Which way the card is currently heading, if far enough to count. */
  armed: PlaceTarget['kind'] | null;
}

export function FlickZones({ card, targets, column, armed }: FlickZonesProps) {
  const canPlay = targets.includes('expedition');
  const costly = placementWeight(column, card) === 'commits';

  return (
    <div className="flick-zones" aria-hidden="true">
      {/*
        Left is discard, and it takes no colour: it is the neutral direction,
        the one that is always open. Right takes the card's own colour, so the
        thing lighting up is the expedition the card belongs to.
      */}
      <div
        className={[
          'flick-zone',
          'flick-zone--discard',
          armed === 'discard' ? 'is-armed' : '',
          targets.includes('discard') ? '' : 'is-dead',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span className="flick-zone__label">Discard</span>
      </div>

      <div
        className={[
          'flick-zone',
          'flick-zone--expedition',
          armed === 'expedition' ? 'is-armed' : '',
          canPlay ? '' : 'is-dead',
          costly ? 'is-costly' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ '--colour': `var(--colour-${card.colour})` } as React.CSSProperties}
      >
        <span className="flick-zone__mark">{COLOUR_MARK[card.colour]}</span>
        <span className="flick-zone__label">
          {canPlay ? throwLabel(column, card) : expeditionHint(column, card)}
        </span>
      </div>
    </div>
  );
}
