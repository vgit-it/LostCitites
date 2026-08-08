// The deck plus the five discard tops — the top of the phone's table.
//
// Stable furniture rather than a phase screen: it is on show for the whole
// turn, because which cards are face up is exactly the information a player
// needs while deciding what to place, and reading it used to mean looking up
// at the tablet. `interactive` is what the draw phase turns on; until then
// the same row is there to be read and not tapped.
//
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
  /** False outside the draw phase: the same row, to be read and not tapped. */
  interactive?: boolean;
  onDraw: (source: DrawSource) => void;
}

export function DrawTargets({
  deckCount,
  discardTops,
  legalDrawSources,
  blockedDrawCardId,
  busy,
  interactive = true,
  onDraw,
}: DrawTargetsProps) {
  const deckLegal = interactive && legalDrawSources.some((s) => s.kind === 'deck');
  const legalColours = new Set(
    interactive ? legalDrawSources.flatMap((s) => (s.kind === 'discard' ? [s.colour] : [])) : [],
  );

  return (
    <div className={`draw-targets${interactive ? '' : ' draw-targets--reading'}`}>
      <h2 className="draw-targets__title">{interactive ? 'Draw a card' : 'On the table'}</h2>

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
            return <CardSlot key={colour} colour={colour} size="md" label={`${colour} empty`} />;
          }

          const blocked = top.id === blockedDrawCardId;
          return (
            // The wrapper carries the flight source id, keeping CardProps
            // closed the same way the hand's slots do.
            <span key={colour} data-draw={colour} className="draw-targets__pile">
            <Card
              card={top}
              size="md"
              dimmed={busy || !legalColours.has(colour)}
              title={blocked ? 'You just discarded this' : undefined}
              onClick={() => onDraw({ kind: 'discard', colour })}
            />
            </span>
          );
        })}
      </div>

      {interactive && blockedDrawCardId && (
        <p className="draw-targets__note label">
          The card you just discarded is locked for this turn.
        </p>
      )}
    </div>
  );
}
