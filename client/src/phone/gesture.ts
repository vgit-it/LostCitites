// The hand's gesture machine, as a pure reducer.
//
// One press can become either of two things and the machine's whole job is
// deciding which: move the thumb and you are fanning the hand; hold still and
// you are picking a card up. Keeping that arbitration here — rather than in
// a tangle of refs inside the component — is what makes the sequence
// testable without a real pointer, which jsdom cannot give us anyway.
//
// No rules logic. `chooseDrop` is handed the server's legalPlacements and
// only reports which of them a release landed on.

import { PlaceTarget } from '@shared/types';
import {
  Drag,
  SPREAD_INITIAL,
  SPREAD_MAX,
  SPREAD_MIN,
  SPREAD_TRAVEL_PX,
  clampSpread,
} from './fan';

/**
 * How long the thumb must sit still to pick a card up. Long enough not to
 * fire while the hand is being fanned, short enough that it does not feel
 * like waiting for permission.
 */
export const HOLD_MS = 220;

/** Movement past this before the hold fires means the gesture is a fan. */
export const MOVE_SLOP_PX = 10;

export type GesturePhase = 'idle' | 'pending' | 'fanning' | 'lifted';

export interface Point {
  x: number;
  y: number;
}

export interface GestureState {
  phase: GesturePhase;
  /** The card the press landed on — the one a hold will lift. */
  cardId: string | null;
  /** Sticky across gestures: the hand keeps the shape you left it in. */
  spread: number;
  /** Offset from the press point. Only meaningful while lifted. */
  drag: Drag;
  /** Where this gesture started, and the spread it started from. */
  origin: Point | null;
  spreadAtPress: number;
}

export type GestureEvent =
  | { t: 'down'; cardId: string | null; x: number; y: number }
  | { t: 'move'; x: number; y: number }
  /** The hold timer fired. */
  | { t: 'hold' }
  | { t: 'up' }
  | { t: 'cancel' };

export const initialGesture: GestureState = {
  phase: 'idle',
  cardId: null,
  spread: SPREAD_INITIAL,
  drag: { x: 0, y: 0 },
  origin: null,
  spreadAtPress: SPREAD_INITIAL,
};

/** Spread carries over; everything else about the gesture is discarded. */
function rest(state: GestureState): GestureState {
  return {
    ...initialGesture,
    spread: state.spread,
    spreadAtPress: state.spread,
  };
}

function spreadFrom(state: GestureState, dx: number): number {
  const range = SPREAD_MAX - SPREAD_MIN;
  return clampSpread(state.spreadAtPress + (dx / SPREAD_TRAVEL_PX) * range);
}

export function gestureReducer(state: GestureState, event: GestureEvent): GestureState {
  switch (event.t) {
    case 'down':
      return {
        ...state,
        phase: 'pending',
        cardId: event.cardId,
        drag: { x: 0, y: 0 },
        origin: { x: event.x, y: event.y },
        spreadAtPress: state.spread,
      };

    case 'move': {
      if (!state.origin) return state;
      const dx = event.x - state.origin.x;
      const dy = event.y - state.origin.y;

      // A lifted card simply follows the thumb.
      if (state.phase === 'lifted') return { ...state, drag: { x: dx, y: dy } };

      if (state.phase === 'fanning') return { ...state, spread: spreadFrom(state, dx) };

      // Still pending: enough travel and this was never a hold. Distance
      // rather than dx alone, so a vertical drag also cancels the pickup —
      // it is not a fan either, but it is certainly not "held still".
      if (state.phase === 'pending' && Math.hypot(dx, dy) > MOVE_SLOP_PX) {
        return { ...state, phase: 'fanning', spread: spreadFrom(state, dx) };
      }
      return state;
    }

    // Too late once the thumb has moved, and nothing to lift if the press
    // missed every card.
    case 'hold':
      return state.phase === 'pending' && state.cardId
        ? { ...state, phase: 'lifted', drag: { x: 0, y: 0 } }
        : state;

    case 'up':
    case 'cancel':
      return rest(state);

    default:
      return state;
  }
}

/** Where a release landed. `null` is neutral space — the cancel gesture. */
export type DropZone = 'expedition' | 'discard' | null;

/**
 * What a release means.
 *
 * `refuse` is a drop onto a zone the server did not offer for this card. The
 * zone is already visibly dead by then, so this is the rare deliberate
 * attempt rather than the common case — it earns a shake, not a silent
 * cancel, because silence reads as a dropped input.
 */
export type DropOutcome =
  | { kind: 'place'; target: PlaceTarget['kind'] }
  | { kind: 'refuse'; target: PlaceTarget['kind'] }
  | { kind: 'cancel' };

export function chooseDrop(zone: DropZone, targets: PlaceTarget['kind'][]): DropOutcome {
  if (!zone) return { kind: 'cancel' };
  return targets.includes(zone) ? { kind: 'place', target: zone } : { kind: 'refuse', target: zone };
}
