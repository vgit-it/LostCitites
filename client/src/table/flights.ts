// Turning a table event into a card's journey across the table.
//
// Pure: an event and the view as it stood *before* that event, in; a plan
// naming what to measure and which way, out. Table.tsx does the measuring and
// the animating. Nothing here touches the DOM, so the rules about which card
// travels where are checkable with plain objects.
//
// The "before" view is not a convenience. The server emits its cue and *then*
// broadcasts the new state, so an event handler on the client is still
// holding the previous view — which is the only place the card just taken off
// a discard pile still exists. By the time the state lands it is gone.

import { Card, Colour, Seat, TableEvent, TableView } from '@shared/types';
import { Edge, edgeOfSeat } from '../shared/flightPath';
import { isFlipped } from '../shared/seating';

export interface FlightPlan {
  /**
   * The card that travels, or null for a card nobody saw: a draw from the
   * deck is face down and stays that way.
   */
  card: Card | null;
  /** What to measure. The on-table end of the journey. */
  anchor: string;
  /** The player's own side of the table — where the card comes from or goes. */
  edge: Edge;
  /** 'in' lands on the anchor; 'out' leaves it. */
  direction: 'in' | 'out';
  /**
   * The card to keep hidden until the flight lands.
   *
   * An arriving card is already in the state that came with the event, so it
   * is on the table before its flight has started. Without this the animation
   * would be covering a card that had already popped into place — which is
   * the exact thing it exists to hide.
   */
  hideCardId: string | null;
  /**
   * Degrees the clone turns over the flight. An expedition card resting in
   * the far player's column faces them (180°); everything else on the table
   * — the shared discard piles, a card leaving toward a phone — stays
   * upright, so this is 0 unless the destination is a flipped seat's own
   * column.
   */
  spin: number;
}

/** Where a placed or discarded card comes to rest. */
function cardAnchor(cardId: string): string {
  return `[data-card-id="${cardId}"]`;
}

/** Where a drawn card was taken from. */
function sourceAnchor(colour: Colour | null): string {
  return colour === null ? '[data-deck]' : `[data-pile="${colour}"]`;
}

export function planFlight(event: TableEvent, before: TableView): FlightPlan | null {
  const seatEdge = (seat: Seat): Edge => edgeOfSeat(seat);

  if (event.name === 'placed') {
    return {
      card: event.card,
      anchor: cardAnchor(event.card.id),
      edge: seatEdge(event.seat),
      direction: 'in',
      hideCardId: event.card.id,
      // The discard pile is shared and stays upright regardless of seat; an
      // expedition card comes to rest facing its owner.
      spin: event.target === 'expedition' && isFlipped(event.seat) ? 180 : 0,
    };
  }

  if (event.name === 'drew') {
    const colour = event.source.kind === 'discard' ? event.source.colour : null;
    return {
      // Straight off the pile as it stood a moment ago. The deck's card is
      // face down and has no identity to show.
      card: colour === null ? null : before.discardTops[colour],
      anchor: sourceAnchor(colour),
      edge: seatEdge(event.seat),
      direction: 'out',
      hideCardId: null,
      // Leaving a shared, upright pile — nothing to turn to face.
      spin: 0,
    };
  }

  // roundOver and matchOver are screen changes, not journeys.
  return null;
}

/** One card of a deal: whose side it goes to, and when it leaves the deck. */
export interface DealStep {
  seat: Seat;
  delayMs: number;
}

/** Between one dealt card and the next — brisk, like a practised dealer. */
export const DEAL_STAGGER_MS = 70;

/**
 * The order a deal goes out in: one card at a time, alternating seats, the
 * seat that moves first getting the first card — the way a dealer works
 * round a real table. Purely cosmetic: the hands are already in the state
 * that arrived with the cue; this only animates backs leaving the deck.
 */
export function planDeal(handSize: number, firstSeat: Seat): DealStep[] {
  const other: Seat = firstSeat === 0 ? 1 : 0;
  return Array.from({ length: handSize * 2 }, (_, i) => ({
    seat: i % 2 === 0 ? firstSeat : other,
    delayMs: i * DEAL_STAGGER_MS,
  }));
}
