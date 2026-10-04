// A card in transit, drawn as a fixed-position clone over everything else.
//
// It is a *clone* for a reason worth keeping in mind: the server answers a
// placement with the next full state, which unmounts the real card within
// milliseconds of the tap. Animating the live element would mean animating
// something React is about to delete. So the real hand re-renders without
// the card immediately, the fan closes underneath on its own transition,
// and this overlay covers the seam.
//
// The alternative — removing the card from local state to buy time — would
// be deriving game state on the client, which the architecture forbids. The
// clone buys the same illusion legitimately.

import { useEffect, useRef } from 'react';
import { Card as CardModel } from '@shared/types';
import { Card } from './Card';
import { Rect } from './flightPath';
import { EASE, FLIGHT_MS, animate } from '../platform/motion';

export type { Rect };

/**
 * A landing settles onto something already on screen, so it shrinks to fit
 * that thing and stays visible. A throw leaves the screen entirely: there is
 * nothing to shrink to, so it keeps its size and fades as it goes.
 */
export type FlightKind = 'land' | 'throw';

export interface CardFlightProps {
  /** Null for a card nobody saw — a draw off the deck flies face down. */
  card: CardModel | null;
  from: Rect;
  to: Rect;
  kind?: FlightKind;
  /** Degrees turned over the flight. A thrown card tumbles a little. */
  spin?: number;
  /** Play the flight backwards — the server refused the move. */
  reversed?: boolean;
  durationMs?: number;
  /**
   * Wait this long before setting off, sitting at `from` meanwhile — how a
   * deal staggers one card after another off the same deck.
   */
  delayMs?: number;
  /**
   * Turn over in the air: leave face down, arrive face up. A card drawn off
   * the deck nobody has seen, becoming the one now in this hand.
   */
  flip?: boolean;
  onDone: () => void;
}

/** A thrown card arcs. Shallow and ballistic: it never passes the target
 *  and never reverses, which is what separates this from bounce. */
const ARC_PX = -18;

export function CardFlight({
  card,
  from,
  to,
  kind = 'land',
  spin = 0,
  reversed = false,
  durationMs = FLIGHT_MS,
  delayMs = 0,
  flip = false,
  onDone,
}: CardFlightProps) {
  const ref = useRef<HTMLDivElement>(null);
  const flipper = useRef<HTMLDivElement>(null);
  // onDone is called from an effect that must run exactly once; keeping it
  // in a ref means a re-rendered parent cannot restart the flight.
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      done.current();
      return;
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    // A landing shrinks toward whatever it is landing on, but never to
    // nothing — a chip is much smaller than a card and vanishing reads as a
    // bug. A throw has no destination to match, so it keeps its size.
    const endScale =
      kind === 'throw' ? 1 : Math.max(0.35, Math.min(1, to.width / (from.width || 1)));
    // Gone by the time it is off the edge, still solid when it settles.
    const endOpacity = kind === 'throw' ? 0 : reversed ? 1 : 0.9;

    const turn = (deg: number) => (deg === 0 ? '' : ` rotate(${deg.toFixed(2)}deg)`);

    const frames: Keyframe[] = [
      { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
      {
        transform:
          `translate(${dx / 2}px, ${dy / 2 + ARC_PX}px) scale(${(1 + endScale) / 2})` +
          turn(spin / 2),
        offset: 0.5,
      },
      {
        transform: `translate(${dx}px, ${dy}px) scale(${endScale})` + turn(spin),
        opacity: endOpacity,
      },
    ];

    let cancelled = false;
    // 'both', not 'forwards', when delayed: the card has to hold its start
    // frame while it waits, or it would show at its resting CSS position.
    const fill: FillMode = delayMs > 0 ? 'both' : 'forwards';
    if (flip && flipper.current) {
      // The turn rides on an inner element so it composes with the travel
      // on the outer one rather than fighting it for `transform`.
      animate(
        flipper.current,
        // Held face down for the first stretch, then turned through the
        // middle of the journey — an even ease, so the edge-on moment
        // reads as a turn rather than a blink.
        [
          { transform: 'rotateY(180deg)' },
          { transform: 'rotateY(180deg)', offset: 0.2 },
          { transform: 'rotateY(0deg)', offset: 0.85 },
          { transform: 'rotateY(0deg)' },
        ],
        { duration: durationMs, easing: 'ease-in-out', fill, delay: delayMs },
      );
    }
    animate(el, reversed ? [...frames].reverse() : frames, {
      duration: durationMs,
      easing: EASE,
      fill,
      delay: delayMs,
    }).then(() => {
      if (!cancelled) done.current();
    });

    return () => {
      cancelled = true;
    };
    // Deliberately once: the flight owns its own lifetime and ends by
    // calling onDone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      className="card-flight"
      aria-hidden="true"
      style={{ left: from.x, top: from.y, width: from.width, height: from.height }}
    >
      {card && flip ? (
        <div ref={flipper} className="card-flight__flipper">
          <div className="card-flight__face">
            <Card card={card} size="lg" />
          </div>
          <div className="card-flight__face card-flight__face--back">
            <div className="card card--lg card--back" />
          </div>
        </div>
      ) : card ? (
        <Card card={card} size="lg" />
      ) : (
        <div className="card card--back" />
      )}
    </div>
  );
}
