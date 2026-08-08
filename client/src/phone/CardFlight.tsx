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
import { Card } from '../shared/Card';
import { EASE, FLIGHT_MS, animate } from '../platform/motion';

/** Just the parts of a DOMRect a flight needs, so tests can build one. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CardFlightProps {
  card: CardModel;
  from: Rect;
  to: Rect;
  /** Play the flight backwards — the server refused the move. */
  reversed?: boolean;
  durationMs?: number;
  onDone: () => void;
}

/** A thrown card arcs. Shallow and ballistic: it never passes the target
 *  and never reverses, which is what separates this from bounce. */
const ARC_PX = -18;

export function CardFlight({
  card,
  from,
  to,
  reversed = false,
  durationMs = FLIGHT_MS,
  onDone,
}: CardFlightProps) {
  const ref = useRef<HTMLDivElement>(null);
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
    // Shrink toward the destination's width, but never to nothing — a chip
    // is much smaller than a card and vanishing reads as a bug.
    const endScale = Math.max(0.35, Math.min(1, to.width / (from.width || 1)));

    const frames: Keyframe[] = [
      { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
      {
        transform: `translate(${dx / 2}px, ${dy / 2 + ARC_PX}px) scale(${(1 + endScale) / 2})`,
        offset: 0.5,
      },
      {
        transform: `translate(${dx}px, ${dy}px) scale(${endScale})`,
        opacity: reversed ? 1 : 0.9,
      },
    ];

    let cancelled = false;
    animate(el, reversed ? [...frames].reverse() : frames, {
      duration: durationMs,
      easing: EASE,
      fill: 'forwards',
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
      <Card card={card} size="lg" />
    </div>
  );
}
