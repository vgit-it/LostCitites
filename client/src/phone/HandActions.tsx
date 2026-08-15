// Every move, as plain buttons, for anyone not throwing cards with a thumb.
//
// Visually hidden until focused — the skip-link pattern. A player using the
// gesture never sees it; a player on a screen reader or a keyboard reaches
// the whole game with Tab. Cheap to keep, and it is the difference between a
// gesture-only interface and an interface only some people can use.
//
// It offers exactly what the server offered: legalPlacements and
// legalDrawSources, no more. No rules logic lives here either.

import { COLOURS, Card as CardModel, Colour, DrawSource, PlaceTarget } from '@shared/types';

export interface HandActionsProps {
  hand: CardModel[];
  legalPlacements: Record<string, PlaceTarget['kind'][]>;
  legalDrawSources: DrawSource[];
  discardTops: Record<Colour, CardModel | null>;
  deckCount: number;
  phase: 'place' | 'draw';
  myTurn: boolean;
  busy?: boolean;
  onPlace: (cardId: string, target: PlaceTarget['kind']) => void;
  onDraw: (source: DrawSource) => void;
}

function name(card: CardModel): string {
  return card.value === 'wager' ? `${card.colour} wager` : `${card.colour} ${card.value}`;
}

export function HandActions({
  hand,
  legalPlacements,
  legalDrawSources,
  discardTops,
  deckCount,
  phase,
  myTurn,
  busy,
  onPlace,
  onDraw,
}: HandActionsProps) {
  if (!myTurn) return null;

  const canDraw = (source: DrawSource) =>
    legalDrawSources.some((s) =>
      s.kind === 'deck' ? source.kind === 'deck' : s.kind === source.kind && s.colour === source.colour,
    );

  return (
    <div className="hand-actions">
      <h2 className="hand-actions__title">
        {phase === 'place' ? 'Place a card' : 'Draw a card'}
      </h2>

      {phase === 'place' &&
        hand.map((card) => {
          const targets = legalPlacements[card.id] ?? [];
          return (
            <span key={card.id}>
              {targets.includes('expedition') && (
                <button
                  type="button"
                  className="hand-actions__button"
                  disabled={busy}
                  onClick={() => onPlace(card.id, 'expedition')}
                >
                  Play {name(card)} to your {card.colour} expedition
                </button>
              )}
              {targets.includes('discard') && (
                <button
                  type="button"
                  className="hand-actions__button"
                  disabled={busy}
                  onClick={() => onPlace(card.id, 'discard')}
                >
                  Discard {name(card)}
                </button>
              )}
            </span>
          );
        })}

      {phase === 'draw' && (
        <>
          {canDraw({ kind: 'deck' }) && (
            <button
              type="button"
              className="hand-actions__button"
              disabled={busy}
              onClick={() => onDraw({ kind: 'deck' })}
            >
              Draw from the deck, {deckCount} left
            </button>
          )}
          {COLOURS.map((colour) => {
            const top = discardTops[colour];
            if (!top || !canDraw({ kind: 'discard', colour })) return null;
            return (
              <button
                key={colour}
                type="button"
                className="hand-actions__button"
                disabled={busy}
                onClick={() => onDraw({ kind: 'discard', colour })}
              >
                Take the {name(top)} from the discards
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
