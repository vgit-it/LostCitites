// The player's hand, fanned the way a hand of cards actually sits, and
// handled the way one actually is: drag across it to fan it open, press and
// hold a card to pick it up, carry it to a zone to commit.
//
// Presentational — cards in, gestures out. It reports raw points on release
// and lets the parent decide what was under them, so the hand knows nothing
// about drop zones, and geometry lives in fan.ts.
//
// Sorted by colour then value so the same card is always in the same place.

import { useEffect, useReducer, useRef } from 'react';
import { COLOURS, Card as CardModel, PlaceTarget } from '@shared/types';
import { Card } from '../shared/Card';
import { vibrateLift, vibrateTick } from '../platform/vibrate';
import { FanSlot, SlotState, fanLayout, slotTransform, spanOf } from './fan';
import { HOLD_MS, Point, gestureReducer, initialGesture } from './gesture';

export interface HandProps {
  cards: CardModel[];
  /** From the server. The phone mutes anything absent from this map. */
  legalPlacements: Record<string, PlaceTarget['kind'][]>;
  selectedId: string | null;
  onSelect: (cardId: string | null) => void;
  disabled?: boolean;
  /** Non-interactive: the turn is elsewhere in the UI. */
  muted?: boolean;
  /** Receded as well — not this player's turn at all. */
  away?: boolean;
  /** A card has come up out of the fan and is now travelling with the thumb. */
  onLift?: (cardId: string) => void;
  /** Every move of a held card, so the parent can light the zone underneath. */
  onDragMove?: (point: Point) => void;
  /** Let go. A null point means the gesture was cancelled, not released. */
  onRelease?: (cardId: string, point: Point | null) => void;
  /** The card the server just refused: shake it, then let it settle back. */
  refusingId?: string | null;
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

/**
 * The one card in `next` that was not in `prev`, or null if this is not a
 * clean single arrival.
 *
 * Returning null on anything else is the point, not caution. A reconnect
 * delivers a fresh full view that may differ from the last one arbitrarily,
 * and a diff-driven animator would answer that with a flurry of bogus
 * flights. Requiring exactly one new card makes that impossible by
 * construction — which is also why opponent cues use events instead of
 * diffing, since their moves have no such single-card guarantee.
 */
export function drawnCardId(prev: CardModel[], next: CardModel[]): string | null {
  const before = new Set(prev.map((c) => c.id));
  const arrived = next.filter((c) => !before.has(c.id));
  return arrived.length === 1 ? arrived[0].id : null;
}

/**
 * The card under a point, or null.
 *
 * Hit-testing through the document rather than per-card refs is what lets a
 * press land on the sliver of a card that its neighbour overlaps, which at a
 * closed spread is most of every card but one.
 */
function cardIdAt(x: number, y: number): string | null {
  if (typeof document.elementFromPoint !== 'function') return null; // jsdom
  return document.elementFromPoint(x, y)?.closest('[data-card-id]')?.getAttribute('data-card-id')
    ?? null;
}

export function Hand({
  cards,
  legalPlacements,
  selectedId,
  onSelect,
  disabled,
  muted,
  away,
  onLift,
  onDragMove,
  onRelease,
  refusingId,
}: HandProps) {
  const [gesture, dispatch] = useReducer(gestureReducer, initialGesture);
  const ordered = sortHand(cards);
  const slots = fanLayout(ordered.length, gesture.spread);
  const span = spanOf(slots);

  /** The pending hold. Cleared the moment the gesture stops being a press. */
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearHold(): void {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }

  // A press is only a pickup for as long as it stays a press. Anything that
  // moves the machine out of `pending` — travel, release, cancel — has to
  // take the timer with it, or the card comes up mid-fan.
  useEffect(() => {
    if (gesture.phase !== 'pending') clearHold();
  }, [gesture.phase]);

  useEffect(() => clearHold, []);

  // Fanning is not choosing, so the raise from the press is withdrawn —
  // otherwise the tray sits there offering actions for a card the player has
  // stopped thinking about and is now just spreading past.
  const fanning = gesture.phase === 'fanning';
  useEffect(() => {
    if (fanning) onSelect(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fanning]);

  // The lift itself, announced once. Driven off the phase rather than from
  // inside the timer callback so the reducer stays the only thing deciding
  // whether a hold became a lift.
  const liftedId = gesture.phase === 'lifted' ? gesture.cardId : null;
  useEffect(() => {
    if (!liftedId) return;
    vibrateLift();
    onSelect(liftedId);
    onLift?.(liftedId);
    // onSelect/onLift are the parent's identity-unstable callbacks; the lift
    // is keyed by the card, and re-firing it because a parent re-rendered
    // would buzz the phone for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liftedId]);

  const className = [
    'hand',
    'hand--fan',
    muted && 'is-muted',
    away && 'is-away',
    gesture.phase !== 'idle' && 'is-gesturing',
    gesture.phase === 'fanning' && 'is-fanning',
  ]
    .filter(Boolean)
    .join(' ');

  function handlePointerDown(event: React.PointerEvent<HTMLUListElement>): void {
    if (disabled || event.button !== 0) return;
    const id = cardIdAt(event.clientX, event.clientY);
    // Capture on the list, not the card: a held card leaves the one it
    // started on, and a fan drag leaves the hand entirely.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dispatch({ t: 'down', cardId: id, x: event.clientX, y: event.clientY });

    // Raising on press keeps a plain tap feeling immediate. The hold turns
    // that raise into a pickup; a drag takes it back.
    if (id && id !== selectedId) {
      onSelect(id);
      vibrateTick();
    }
    if (id) holdTimer.current = setTimeout(() => dispatch({ t: 'hold' }), HOLD_MS);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLUListElement>): void {
    if (disabled || gesture.phase === 'idle') return;
    dispatch({ t: 'move', x: event.clientX, y: event.clientY });
    // `gesture` is this render's state, so the phase read here is the one
    // *before* this move — which is what we want: a card that was lifted
    // stays lifted, and the pending -> fanning transition is the reducer's
    // to make and the effect below's to react to.
    if (gesture.phase === 'lifted') onDragMove?.({ x: event.clientX, y: event.clientY });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLUListElement>): void {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const held = gesture.phase === 'lifted' ? gesture.cardId : null;
    const cancelled = event.type === 'pointercancel';
    dispatch({ t: cancelled ? 'cancel' : 'up' });

    if (held) {
      onRelease?.(held, cancelled ? null : { x: event.clientX, y: event.clientY });
    }
  }

  return (
    // role="list" is explicit because Safari VoiceOver drops list semantics
    // from a ul with list-style: none.
    <ul
      className={className}
      role="list"
      aria-label="Your hand"
      // Spread trades against card size: the fan's width budget is the
      // viewport, so opening it wide yields smaller cards rather than cards
      // that overflow a container nothing is allowed to clip.
      style={{ '--fan-span': span.toFixed(3) } as React.CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {ordered.map((card, i) => {
        // Legality is only worth drawing while there is a placement to make.
        // The server sends no legalPlacements during the draw phase or on
        // the opponent's turn, so reading it then marks the whole hand
        // unplayable and greys out the one thing the draw decision runs on:
        // which colours you are holding.
        const playable = muted || (legalPlacements[card.id] ?? []).length > 0;
        const selected = card.id === selectedId;
        const dragging = card.id === liftedId;
        const slot: FanSlot = slots[i];
        const state: SlotState = selected ? 'lifted' : playable ? 'rest' : 'muted';

        return (
          <li
            key={card.id}
            // The hit-test id: a press resolves the card under the thumb
            // through this, without a ref per card.
            data-card-id={card.id}
            className={[
              'hand__slot',
              playable ? '' : 'is-muted',
              selected ? 'is-lifted' : '',
              dragging ? 'is-dragging' : '',
              card.id === refusingId ? 'is-refusing' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            // The wrapper's transform is *where the card sits*; the card's own
            // is *what it is doing*. Keeping them on separate elements means
            // they multiply instead of clobbering each other.
            style={{
              transform: slotTransform(slot, state, dragging ? gesture.drag : undefined),
              zIndex: selected ? 99 : slot.zIndex,
            }}
          >
            <Card
              card={card}
              size="lg"
              selected={selected}
              // Only a hand that is not this player's to act on is truly
              // disabled. An unplayable card stays live so it can be picked
              // up and have the dead zone explain itself.
              dimmed={disabled}
              // Keyboard only. A pointer-driven click is redundant here —
              // the press already raised this card — and it is unreliable
              // besides: press and release on two different cards fires
              // click on their common ancestor, never the button.
              // detail === 0 is the one reliable way to tell the two apart,
              // with no timers or flags.
              onClick={(event) => {
                if (event.detail === 0) onSelect(card.id);
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}
