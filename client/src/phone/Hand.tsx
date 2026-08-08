// The player's hand. Presentational: cards in, taps out.
// Sorted by colour then value so the same card is always in the same place.

import { COLOURS, Card as CardModel, PlaceTarget } from '@shared/types';
import { Card } from '../shared/Card';

export interface HandProps {
  cards: CardModel[];
  /** From the server. The phone greys anything absent from this map. */
  legalPlacements: Record<string, PlaceTarget['kind'][]>;
  selectedId: string | null;
  onSelect: (cardId: string) => void;
  disabled?: boolean;
}

/** Wagers lead their colour, then numbers ascending — the order they are played in. */
export function sortHand(cards: CardModel[]): CardModel[] {
  return [...cards].sort((a, b) => {
    const byColour = COLOURS.indexOf(a.colour) - COLOURS.indexOf(b.colour);
    if (byColour !== 0) return byColour;
    if (a.value === 'wager' && b.value === 'wager') return a.id.localeCompare(b.id);
    if (a.value === 'wager') return -1;
    if (b.value === 'wager') return 1;
    return (a.value as number) - (b.value as number);
  });
}

export function Hand({ cards, legalPlacements, selectedId, onSelect, disabled }: HandProps) {
  return (
    <div className="hand" role="group" aria-label="Your hand">
      {sortHand(cards).map((card) => {
        const playable = (legalPlacements[card.id] ?? []).length > 0;
        return (
          <Card
            key={card.id}
            card={card}
            size="lg"
            selected={card.id === selectedId}
            dimmed={disabled || !playable}
            onClick={() => onSelect(card.id)}
          />
        );
      })}
    </div>
  );
}
