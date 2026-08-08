// The player's hand, fanned the way a hand of cards actually sits.
// Presentational: cards in, taps out.
//
// Sorted by colour then value so the same card is always in the same place.

import { useRef } from 'react';
import { COLOURS, Card as CardModel, PlaceTarget } from '@shared/types';
import { Card } from '../shared/Card';
import { vibrateTick } from '../platform/vibrate';

export interface HandProps {
  cards: CardModel[];
  /** From the server. The phone mutes anything absent from this map. */
  legalPlacements: Record<string, PlaceTarget['kind'][]>;
  selectedId: string | null;
  onSelect: (cardId: string) => void;
  disabled?: boolean;
  /** Receded and non-interactive while the turn is elsewhere in the UI. */
  muted?: boolean;
}

export interface FanSlot {
  /** Ready for the wrapper's inline style, in the resting state. */
  transform: string;
  /** Percent of card width, horizontal. Kept so states can recompose. */
  tx: number;
  /** Percent of card height, vertical. */
  ty: number;
  /** Kept separate so a lift or a flight can unwind the tilt back to level. */
  angle: number;
  zIndex: number;
}

/**
 * What a slot is doing. The three are mutually exclusive and the transform
 * is composed in JS rather than layered in CSS, because an inline transform
 * beats a stylesheet one — a CSS rule could not unwind the fan's tilt.
 */
export type SlotState = 'rest' | 'muted' | 'lifted';

/** Percent of card height. ~28px at a 132px-tall card. */
const LIFT_PCT = 21;
/** Percent of card height. An unplayable card sits back in the hand. */
const SIT_BACK_PCT = 4;

const STEP_DEG = 4.5; // per-card tilt — the "thickness" of the hand
const MAX_SPREAD_DEG = 34; // total, so a full hand never curls into a claw
const GAP_W = 0.4; // neighbour spacing, in card widths
const ASPECT = 1.5; // matches .card's aspect-ratio: 2 / 3

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
 * Cards swung about a pivot below the wrist: middle highest, ends falling away.
 *
 * Percentages in a transform resolve against the element's own border box, so
 * this is a pure function of card count — responsive by construction, with no
 * measurement, no ResizeObserver, and exact strings that unit-test the way
 * profilePoints does. Card width drives the physical size; the geometry never
 * changes.
 */
export function fanLayout(n: number): FanSlot[] {
  if (n <= 0) return [];
  if (n === 1) {
    return [{ transform: 'translate(0.00%, 0.00%) rotate(0.00deg)', tx: 0, ty: 0, angle: 0, zIndex: 0 }];
  }

  const step = Math.min(STEP_DEG, MAX_SPREAD_DEG / (n - 1));
  const half = (n - 1) / 2;
  const radiusW = GAP_W / ((step * Math.PI) / 180); // in card widths

  return Array.from({ length: n }, (_, i) => {
    const angle = (i - half) * step;
    const rad = (angle * Math.PI) / 180;
    const tx = radiusW * Math.sin(rad) * 100;
    const ty = ((radiusW * (1 - Math.cos(rad))) / ASPECT) * 100;
    return {
      transform: fanTransform(tx, ty, angle),
      tx,
      ty,
      angle,
      zIndex: i,
    };
  });
}

function fanTransform(tx: number, ty: number, angle: number): string {
  return `translate(${tx.toFixed(2)}%, ${ty.toFixed(2)}%) rotate(${angle.toFixed(2)}deg)`;
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

/** The wrapper transform for a slot in a given state. Pure. */
export function slotTransform(slot: FanSlot, state: SlotState): string {
  switch (state) {
    // Out of the fan entirely: rises clear of its neighbours, levels off so
    // the face is square to the eye, and grows just enough to read as picked
    // up rather than nudged.
    case 'lifted':
      return `translate(${slot.tx.toFixed(2)}%, ${(-LIFT_PCT).toFixed(2)}%) rotate(0.00deg) scale(1.06)`;
    case 'muted':
      return fanTransform(slot.tx, slot.ty + SIT_BACK_PCT, slot.angle);
    default:
      return slot.transform;
  }
}

/**
 * The card under a point, or null.
 *
 * Hit-testing through the document rather than per-card refs is what makes
 * scrubbing work: the thumb slides across slivers of card and every one of
 * them resolves, including the parts overlapped by a neighbour.
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
}: HandProps) {
  const ordered = sortHand(cards);
  const slots = fanLayout(ordered.length);
  const scrubbing = useRef(false);

  const className = ['hand', 'hand--fan', muted && 'is-muted'].filter(Boolean).join(' ');

  /** Raise whatever the thumb is over, if it is not already raised. */
  function raiseAt(x: number, y: number): void {
    const id = cardIdAt(x, y);
    if (!id || id === selectedId) return;
    onSelect(id);
    vibrateTick();
  }

  function handlePointerDown(event: React.PointerEvent<HTMLUListElement>): void {
    if (disabled || event.button !== 0) return;
    scrubbing.current = true;
    // Capture on the list, not the card: the thumb will leave the card it
    // started on, and we still want its moves.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    raiseAt(event.clientX, event.clientY);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLUListElement>): void {
    if (!scrubbing.current || disabled) return;
    raiseAt(event.clientX, event.clientY);
  }

  function endScrub(event: React.PointerEvent<HTMLUListElement>): void {
    scrubbing.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  return (
    // role="list" is explicit because Safari VoiceOver drops list semantics
    // from a ul with list-style: none.
    <ul
      className={className}
      role="list"
      aria-label="Your hand"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endScrub}
      onPointerCancel={endScrub}
    >
      {ordered.map((card, i) => {
        const playable = (legalPlacements[card.id] ?? []).length > 0;
        const selected = card.id === selectedId;
        const slot = slots[i];
        const state: SlotState = selected ? 'lifted' : playable ? 'rest' : 'muted';

        return (
          <li
            key={card.id}
            // The hit-test id: a pointer scrub resolves the card under the
            // thumb through this, without a ref per card.
            data-card-id={card.id}
            className={`hand__slot${playable ? '' : ' is-muted'}${selected ? ' is-lifted' : ''}`}
            // The wrapper's transform is *where the card sits*; the card's own
            // is *what it is doing*. Keeping them on separate elements means
            // they multiply instead of clobbering each other.
            style={{ transform: slotTransform(slot, state), zIndex: selected ? 99 : slot.zIndex }}
          >
            <Card
              card={card}
              size="lg"
              selected={selected}
              // Only a hand that is not this player's to act on is truly
              // disabled. An unplayable card stays live so it can be tapped
              // and explain itself.
              dimmed={disabled}
              // Keyboard only. A pointer-driven click is redundant here —
              // the scrub already raised this card on pointerdown — and it
              // is unreliable besides: press and release on two different
              // cards fires click on their common ancestor, never the
              // button. detail === 0 is the one reliable way to tell the
              // two apart, with no timers or flags.
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
