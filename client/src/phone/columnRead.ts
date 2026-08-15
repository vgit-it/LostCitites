// Reading a player's own column back to them.
//
// Both helpers *report*; neither decides anything. Legality stays entirely
// with the server's legalPlacements, which is why these take a column and a
// card and return words rather than a verdict.

import { Card as CardModel } from '@shared/types';

/**
 * Why a card cannot go to its expedition, said as the state of the column
 * rather than as a rule.
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

/**
 * Whether a placement is the one move in Lost Cities you cannot walk back:
 * starting a column commits to −20 before a single point is scored.
 */
export function placementWeight(column: CardModel[], card: CardModel): 'commits' | 'normal' {
  return column.length === 0 && card.value !== 'wager' ? 'commits' : 'normal';
}

/**
 * What the wash on the right says while a card is carried over it.
 *
 * The cost is in the label rather than behind a confirmation step: the throw
 * is one motion and interrupting it to ask "are you sure" would undo the
 * point of the gesture. Naming the −20 before the card leaves is the warning.
 */
export function throwLabel(column: CardModel[], card: CardModel): string {
  return placementWeight(column, card) === 'commits'
    ? `Start ${card.colour} · −20`
    : `Play to ${card.colour}`;
}
