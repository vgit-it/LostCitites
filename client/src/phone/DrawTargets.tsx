// The draw half of a turn: the deck plus the five discard tops.
// Empty piles and the just-discarded card are greyed and non-tappable,
// entirely on the strength of the server's legalDrawSources.

import { COLOURS, Card as CardModel, Colour, DrawSource } from '@shared/types';
import { Card, CardSlot } from '../shared/Card';

export interface DrawTargetsProps {
  deckCount: number;
  discardTops: Record<Colour, CardModel | null>;
  legalDrawSources: DrawSource[];
  blockedDrawCardId: string | null;
  busy?: boolean;
  onDraw: (source: DrawSource) => void;
}

export function DrawTargets({
  deckCount,
  discardTops,
  legalDrawSources,
  blockedDrawCardId,
  busy,
  onDraw,
}: DrawTargetsProps) {
  const deckLegal = legalDrawSources.some((s) => s.kind === 'deck');
  const legalColours = new Set(
    legalDrawSources.flatMap((s) => (s.kind === 'discard' ? [s.colour] : [])),
  );

  return (
    <div className="draw-targets">
      <h2 className="draw-targets__title">Draw a card</h2>

      <button
        type="button"
        className="draw-deck"
        disabled={!deckLegal || busy}
        onClick={() => onDraw({ kind: 'deck' })}
      >
        <span className="draw-deck__label">Deck</span>
        <span className="draw-deck__count">{deckCount}</span>
        <span className="label">left</span>
      </button>

      <div className="draw-targets__piles">
        {COLOURS.map((colour) => {
          const top = discardTops[colour];
          if (!top) {
            return <CardSlot key={colour} colour={colour} size="lg" label={`${colour} empty`} />;
          }

          const blocked = top.id === blockedDrawCardId;
          return (
            // The wrapper carries the flight source id, keeping CardProps
            // closed the same way the hand's slots do.
            <span key={colour} data-draw={colour} className="draw-targets__pile">
            <Card
              card={top}
              size="lg"
              dimmed={busy || !legalColours.has(colour)}
              title={blocked ? 'You just discarded this' : undefined}
              onClick={() => onDraw({ kind: 'discard', colour })}
            />
            </span>
          );
        })}
      </div>

      {blockedDrawCardId && (
        <p className="draw-targets__note label">
          The card you just discarded is locked for this turn.
        </p>
      )}
    </div>
  );
}
