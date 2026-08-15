// The shared centre of the table: draw pile count plus the five discard tops.
//
// The one place the table takes input, and only during a draw phase. See
// drawGesture.ts for why a reach is safe where a tap was not: the player to
// move presses a pile the server has marked legal and pulls it toward their
// own edge of the table. Everything else here is still read-only.

import { useEffect, useRef, useState } from 'react';
import { COLOURS, Card as CardModel, Colour, DrawSource, Seat } from '@shared/types';
import { Card, CardSlot } from '../shared/Card';
import { Sample, trimSamples, velocityFrom } from '../shared/carry';
import { reachOutcome, towardSeat } from './drawGesture';

export interface DiscardRowProps {
  deckCount: number;
  discardTops: Record<Colour, CardModel | null>;
  /** A card still in the air; see ColumnProps. */
  arrivingId?: string | null;
  /**
   * From the server. Empty outside a draw phase, which is what leaves the row
   * inert the rest of the time — the table does no rules work of its own.
   */
  legalDrawSources?: DrawSource[];
  /** Whose reach this is: the player to move. */
  activeSeat?: Seat;
  onDraw?: (source: DrawSource) => void;
}

/** Amber below 10, red below 5 — the round is about to end. */
export function deckUrgency(deckCount: number): 'normal' | 'low' | 'critical' {
  if (deckCount < 5) return 'critical';
  if (deckCount < 10) return 'low';
  return 'normal';
}

/** The source under a press, from the anchors the flights already use. */
function sourceAt(target: EventTarget | null): DrawSource | null {
  const el = (target as Element | null)?.closest?.('[data-pile], [data-deck]');
  if (!el) return null;
  const colour = el.getAttribute('data-pile');
  return colour ? { kind: 'discard', colour: colour as Colour } : { kind: 'deck' };
}

function sameSource(a: DrawSource, b: DrawSource): boolean {
  return a.kind === 'deck' ? b.kind === 'deck' : b.kind === 'discard' && a.colour === b.colour;
}

export function DiscardRow({
  deckCount,
  discardTops,
  arrivingId,
  legalDrawSources = [],
  activeSeat,
  onDraw,
}: DiscardRowProps) {
  /** The source being pulled, and how far it has come. */
  const [reach, setReach] = useState<{ source: DrawSource; dy: number } | null>(null);
  const origin = useRef<number>(0);
  const samples = useRef<Sample[]>([]);

  const armed = legalDrawSources.length > 0 && activeSeat !== undefined && onDraw !== undefined;

  // A new state has landed, so the pile the finger was on has changed under
  // it. Letting the reach survive that would leave a stale card lifted.
  useEffect(() => setReach(null), [discardTops, deckCount]);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (!armed || event.button !== 0) return;
    const source = sourceAt(event.target);
    if (!source || !legalDrawSources.some((s) => sameSource(s, source))) return;

    event.currentTarget.setPointerCapture?.(event.pointerId);
    origin.current = event.clientY;
    samples.current = [{ x: event.clientY, t: event.timeStamp }];
    setReach({ source, dy: 0 });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (!reach) return;
    samples.current = [
      ...trimSamples(samples.current, event.timeStamp),
      { x: event.clientY, t: event.timeStamp },
    ];
    setReach({ ...reach, dy: event.clientY - origin.current });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!reach || activeSeat === undefined) return;

    const taken =
      event.type !== 'pointercancel' &&
      reachOutcome({ dy: reach.dy, vy: velocityFrom(samples.current), seat: activeSeat }) === 'take';

    // The lift is *not* undone on a take. The card is left where the finger
    // dragged it so the flight that follows measures it there and carries on
    // from the same place — snapping it home first and flying it out again
    // would animate the journey the player just made by hand.
    if (!taken) setReach(null);
    else onDraw?.(reach.source);
  }

  /** How far a source has been pulled, and whether that is toward its player. */
  function pullOf(source: DrawSource): { dy: number; toward: boolean } | null {
    if (!reach || !sameSource(reach.source, source)) return null;
    const toward = activeSeat !== undefined && reach.dy * towardSeat(activeSeat) > 0;
    return { dy: reach.dy, toward };
  }

  function liftStyle(source: DrawSource): React.CSSProperties | undefined {
    const pull = pullOf(source);
    return pull ? { transform: `translateY(${pull.dy.toFixed(1)}px)` } : undefined;
  }

  function liftClass(source: DrawSource): string {
    const pull = pullOf(source);
    if (!pull) return '';
    // Only a pull toward the acting player's own edge reads as taking it.
    return pull.toward ? ' is-reaching' : ' is-reaching is-wrong-way';
  }

  const deckLegal = armed && legalDrawSources.some((s) => s.kind === 'deck');
  const legalColours = new Set(
    legalDrawSources.flatMap((s) => (s.kind === 'discard' ? [s.colour] : [])),
  );

  return (
    <div
      className={`discard-row${armed ? ' is-armed' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* data-deck and data-pile are both the reach's hit test and the
          anchor a drawn card's flight is measured from: the pile survives
          losing its top card, and the card that left it does not. */}
      <div
        className={
          `deck deck--${deckUrgency(deckCount)}` +
          (deckLegal ? ' is-drawable' : '') +
          liftClass({ kind: 'deck' })
        }
        data-deck
        style={liftStyle({ kind: 'deck' })}
      >
        <span className="deck__count">{deckCount}</span>
        <span className="label">left</span>
      </div>

      <div className="discard-row__piles">
        {COLOURS.map((colour) => {
          const top = discardTops[colour];
          const source: DrawSource = { kind: 'discard', colour };
          return (
            <div
              className={
                'discard-row__pile' +
                (top && top.id === arrivingId ? ' is-arriving' : '') +
                (armed && legalColours.has(colour) ? ' is-drawable' : '') +
                liftClass(source)
              }
              key={colour}
              data-pile={colour}
              data-card-id={top?.id}
              style={liftStyle(source)}
            >
              {top ? (
                <Card card={top} size="md" />
              ) : (
                <CardSlot colour={colour} size="md" label={`${colour} discard empty`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
