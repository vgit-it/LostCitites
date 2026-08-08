// Actions for the selected card. Buttons name what happens — "Play to Blue",
// never "Confirm" (BUILD_SPEC §8).
//
// Contains no rules logic: which targets are offered comes from the server's
// legalPlacements. The hint text only reads back the column's current state.

import { Card as CardModel, PlaceTarget } from '@shared/types';

export interface PlaceActionsProps {
  card: CardModel;
  /** Precomputed by the server for this exact card. */
  targets: PlaceTarget['kind'][];
  /** The player's own column for this card's colour, for the hint only. */
  column: CardModel[];
  busy?: boolean;
  onPlace: (target: PlaceTarget['kind']) => void;
}

/**
 * Explains a missing 'expedition' target by reading the column back to the
 * player. It reports state; it does not decide legality.
 */
export function expeditionHint(column: CardModel[], card: CardModel): string {
  const numbers = column.filter((c) => c.value !== 'wager');
  if (card.value === 'wager') {
    return numbers.length > 0
      ? `${card.colour} is already under way — wagers must come first`
      : `Cannot start ${card.colour}`;
  }
  if (numbers.length === 0) return `Cannot start ${card.colour}`;
  return `${card.colour} is at ${numbers[numbers.length - 1].value as number}`;
}

export function PlaceActions({ card, targets, column, busy, onPlace }: PlaceActionsProps) {
  const canPlay = targets.includes('expedition');

  return (
    <div className="place-actions">
      {/*
        No preview card: the selected card is already lifted out of the fan
        below, and a second copy would push the tray past the height that
        keeps selection reflow-free.

        data-zone marks each button as a flight destination.
      */}
      <div className="place-actions__buttons">
        <button
          type="button"
          className="action action--play"
          data-zone={card.colour}
          disabled={!canPlay || busy}
          onClick={() => onPlace('expedition')}
        >
          Play to {card.colour}
        </button>
        <button
          type="button"
          className="action action--discard"
          data-zone="discard"
          disabled={!targets.includes('discard') || busy}
          onClick={() => onPlace('discard')}
        >
          Discard
        </button>
      </div>

      {!canPlay && <p className="place-actions__hint label">{expeditionHint(column, card)}</p>}
    </div>
  );
}
