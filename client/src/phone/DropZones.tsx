// The two commit targets, shown only while a card is held above the hand.
//
// Both sit at the top, so there is exactly one direction of travel and
// everything below them is neutral space — which is what "release without
// reaching a zone puts the card back" means. That neutral space is now the
// gesture a player makes when they change their mind; it used to be a
// downward flick, and discard could not have the bottom of the screen while
// that was true.
//
// Presentational and aria-hidden: this is a drag affordance. The labelled,
// focusable route to the same two intents is PlaceActions, which the tray
// shows when a card is selected by tap or keyboard rather than held.
//
// No rules logic — `targets` is the server's legalPlacements for this exact
// card, and a zone absent from it renders dead with the reason read back.

import { Card as CardModel, PlaceTarget } from '@shared/types';
import { COLOUR_MARK } from '../shared/Card';
import { DropZone } from './gesture';
import { expeditionHint, placementWeight } from './PlaceActions';

export interface DropZonesProps {
  card: CardModel;
  /** Precomputed by the server for this exact card. */
  targets: PlaceTarget['kind'][];
  /** The player's own column for this card's colour, for the label only. */
  column: CardModel[];
  /** Which zone the thumb is currently over. */
  hovered: DropZone;
}

/**
 * What the expedition zone says. Starting a column is the one placement that
 * cannot be walked back — it commits to −20 before a point is scored — so
 * the cost is on the zone itself, live, while the thumb is over it. A drag
 * and hold is hard enough to do by accident that the label carries the
 * warning the old two-tap arm used to.
 */
export function expeditionLabel(column: CardModel[], card: CardModel): string {
  return placementWeight(column, card) === 'commits'
    ? `Start ${card.colour} · −20`
    : `Play to ${card.colour}`;
}

export function DropZones({ card, targets, column, hovered }: DropZonesProps) {
  const canPlay = targets.includes('expedition');
  const canDiscard = targets.includes('discard');
  const commits = placementWeight(column, card) === 'commits';

  return (
    <div className="drop-zones" aria-hidden="true">
      <div
        data-drop="expedition"
        data-zone={card.colour}
        className={[
          'drop-zone',
          'drop-zone--expedition',
          canPlay ? '' : 'is-dead',
          commits ? 'is-costly' : '',
          hovered === 'expedition' ? 'is-over' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ '--colour': `var(--colour-${card.colour})` } as React.CSSProperties}
      >
        <span className="drop-zone__mark">{COLOUR_MARK[card.colour]}</span>
        <span className="drop-zone__label">
          {canPlay ? expeditionLabel(column, card) : expeditionHint(column, card)}
        </span>
      </div>

      <div
        data-drop="discard"
        data-zone="discard"
        className={[
          'drop-zone',
          'drop-zone--discard',
          canDiscard ? '' : 'is-dead',
          hovered === 'discard' ? 'is-over' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span className="drop-zone__mark">↓</span>
        <span className="drop-zone__label">Discard</span>
      </div>
    </div>
  );
}
