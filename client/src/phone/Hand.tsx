// The player's hand: a row of cards you pick up and throw.
//
// Press a card and it comes up under your finger and stays up while the
// finger is down. Throw it right to play it, left to discard it, let go
// anywhere else and it drops back into the row.
//
// Presentational — cards in, a decision out. The hand reports *which way the
// card went*, not what was underneath it, so it needs to know nothing about
// what a turn is or where anything lives. The arithmetic is all in
// shared/carry.ts, throw.ts and gesture.ts; this file owns the pointer events
// and the animation frame.
//
// Sorted by colour then value so the same card is always in the same place.

import { useEffect, useReducer, useRef, useState } from 'react';
import { COLOURS, Card as CardModel, PlaceTarget } from '@shared/types';
import { Card } from '../shared/Card';
import { vibrateLift, vibrateZone } from '../platform/vibrate';
import {
  CARRY_LIFT_PX,
  Point,
  followStep,
  isSettled,
  tiltFor,
  velocityFrom,
} from '../shared/carry';
import { Throw, armedSide, flickOutcome } from './throw';
import { dragOf, gestureReducer, initialGesture } from './gesture';

export interface HandProps {
  cards: CardModel[];
  /** From the server. The phone mutes anything absent from this map. */
  legalPlacements: Record<string, PlaceTarget['kind'][]>;
  disabled?: boolean;
  /** Non-interactive: it is this player's turn, but not to place. */
  muted?: boolean;
  /** Receded as well — not this player's turn at all. */
  away?: boolean;
  /** A card has come up under the finger. */
  onCarry?: (cardId: string | null) => void;
  /** Which way the carried card is currently leaning, for the wash behind it. */
  onArmed?: (side: PlaceTarget['kind'] | null) => void;
  /** Let go. 'return' and 'refuse' never leave the hand. */
  onThrow?: (cardId: string, outcome: Throw) => void;
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
 * press land on a card wherever it actually is on screen, including while it
 * is mid-transition back into the row.
 */
function cardIdAt(x: number, y: number): string | null {
  if (typeof document.elementFromPoint !== 'function') return null; // jsdom
  return (
    document.elementFromPoint(x, y)?.closest('[data-card-id]')?.getAttribute('data-card-id') ?? null
  );
}

/** Where the carried card is drawn, relative to its slot in the row. */
interface Carry {
  x: number;
  y: number;
  tilt: number;
}

const AT_REST: Carry = { x: 0, y: 0, tilt: 0 };

export function Hand({
  cards,
  legalPlacements,
  disabled,
  muted,
  away,
  onCarry,
  onArmed,
  onThrow,
  refusingId,
}: HandProps) {
  const [gesture, dispatch] = useReducer(gestureReducer, initialGesture);
  const ordered = sortHand(cards);

  // Where the carried card is *drawn*, which trails where the finger *is*.
  // In state rather than a ref because it is what the render reads; the
  // frame loop below is the only thing that writes it.
  const [carry, setCarry] = useState<Carry>(AT_REST);
  const target = useRef<Point>({ x: 0, y: 0 });
  const drawn = useRef<Point>({ x: 0, y: 0 });

  const carriedId = gesture.phase === 'carrying' ? gesture.cardId : null;
  const drag = dragOf(gesture);
  target.current = { x: drag.x, y: drag.y - CARRY_LIFT_PX };

  // Tell the parent as the carry starts and ends, so the wash can appear.
  // Guarded against the mount pass: reporting "nothing is carried" before
  // anything has been touched is not news, and it would arrive as a state
  // update on every fresh render of the hand.
  const notified = useRef<string | null>(null);
  useEffect(() => {
    if (notified.current === carriedId) return;
    notified.current = carriedId;

    if (carriedId) vibrateLift();
    onCarry?.(carriedId);
    if (!carriedId) {
      drawn.current = { x: 0, y: 0 };
      setCarry(AT_REST);
    }
    // onCarry is a fresh closure every render; reacting to it would restart
    // the carry on every parent update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carriedId]);

  // The follow. One rAF loop for as long as a card is up: the card eases
  // toward the finger rather than being pinned to it, and its tilt falls out
  // of how far it is trailing.
  useEffect(() => {
    if (!carriedId || typeof requestAnimationFrame !== 'function') return;

    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = now - last;
      last = now;

      if (!isSettled(drawn.current, target.current)) {
        drawn.current = followStep(drawn.current, target.current, dt);
        setCarry({
          x: drawn.current.x,
          y: drawn.current.y,
          tilt: tiltFor(target.current.x - drawn.current.x),
        });
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [carriedId]);

  // Which wash is lit. Buzzed once per crossing, not per move event.
  const armed = carriedId ? armedSide(drag.x) : null;
  const lastArmed = useRef<PlaceTarget['kind'] | null>(null);
  useEffect(() => {
    if (armed === lastArmed.current) return;
    if (armed) vibrateZone();
    lastArmed.current = armed;
    onArmed?.(armed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

  function handlePointerDown(event: React.PointerEvent<HTMLUListElement>): void {
    if (disabled || muted || event.button !== 0) return;
    const id = cardIdAt(event.clientX, event.clientY);
    if (!id) return;

    // Captured so the card keeps following even once the finger has left the
    // row — which it will, since a throw ends at the edge of the screen.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dispatch({ t: 'down', cardId: id, x: event.clientX, y: event.clientY, at: event.timeStamp });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLUListElement>): void {
    if (gesture.phase !== 'carrying') return;
    dispatch({ t: 'move', x: event.clientX, y: event.clientY, at: event.timeStamp });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLUListElement>): void {
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    const id = gesture.phase === 'carrying' ? gesture.cardId : null;
    const cancelled = event.type === 'pointercancel';
    const outcome: Throw = cancelled
      ? 'return'
      : flickOutcome({
          dx: dragOf(gesture).x,
          vx: velocityFrom(gesture.samples),
          legalTargets: id ? legalPlacements[id] ?? [] : [],
        });

    dispatch({ t: cancelled ? 'cancel' : 'up' });
    if (id) onThrow?.(id, outcome);
  }

  const className = [
    'hand',
    muted ? 'is-muted' : '',
    away ? 'is-away' : '',
    carriedId ? 'is-carrying' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <ul
      className={className}
      role="list"
      aria-label="Your hand"
      // The row divides the width it has by the cards in it; there is no
      // measuring and no fan geometry left to resolve.
      style={{ '--hand-count': ordered.length } as React.CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {ordered.map((card) => {
        const playable = muted || (legalPlacements[card.id] ?? []).length > 0;
        const carried = card.id === carriedId;

        return (
          <li
            data-card-id={card.id}
            key={card.id}
            className={[
              'hand__slot',
              playable ? '' : 'is-muted',
              carried ? 'is-carried' : '',
              card.id === refusingId ? 'is-refusing' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={
              carried
                ? ({
                    transform: `translate3d(${carry.x.toFixed(1)}px, ${carry.y.toFixed(1)}px, 0) rotate(${carry.tilt.toFixed(2)}deg) scale(1.12)`,
                    zIndex: 99,
                  } as React.CSSProperties)
                : undefined
            }
          >
            <Card card={card} size="lg" dimmed={disabled} />
          </li>
        );
      })}
    </ul>
  );
}
