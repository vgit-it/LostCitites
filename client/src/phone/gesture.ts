// The carry gesture as a reducer: press, move, release.
//
// Pure and separately tested, so the arbitration is checkable without a
// browser. `Hand` owns the pointer events and the animation frame; everything
// about *what the gesture is* lives here.
//
// There is no hold timer and no threshold to cross before a card lifts. The
// card comes up on contact and stays up as long as the finger is down —
// pressing a card and picking a card are the same act, so there is nothing
// for a delay to disambiguate.

import { Point, Sample, trimSamples } from '../shared/carry';

export type GesturePhase = 'idle' | 'carrying';

export interface GestureState {
  phase: GesturePhase;
  cardId: string | null;
  /** Where the finger went down. Displacement is measured from here. */
  origin: Point | null;
  /** Where the finger is now. */
  pointer: Point | null;
  /** Trailing horizontal samples, for the release velocity. */
  samples: Sample[];
}

export type GestureEvent =
  | { t: 'down'; cardId: string | null; x: number; y: number; at: number }
  | { t: 'move'; x: number; y: number; at: number }
  | { t: 'up' }
  | { t: 'cancel' };

export const initialGesture: GestureState = {
  phase: 'idle',
  cardId: null,
  origin: null,
  pointer: null,
  samples: [],
};

export function gestureReducer(state: GestureState, event: GestureEvent): GestureState {
  switch (event.t) {
    case 'down': {
      // A press that lands between cards is not a carry. Staying idle means
      // the move handler has nothing to do and the hand does not twitch.
      if (!event.cardId) return initialGesture;

      const at = { x: event.x, y: event.y };
      return {
        phase: 'carrying',
        cardId: event.cardId,
        origin: at,
        pointer: at,
        samples: [{ x: event.x, t: event.at }],
      };
    }

    case 'move': {
      if (state.phase !== 'carrying') return state;
      return {
        ...state,
        pointer: { x: event.x, y: event.y },
        samples: [...trimSamples(state.samples, event.at), { x: event.x, t: event.at }],
      };
    }

    case 'up':
    case 'cancel':
      return initialGesture;
  }
}

/** How far the finger has travelled since it went down. */
export function dragOf(state: GestureState): Point {
  if (!state.origin || !state.pointer) return { x: 0, y: 0 };
  return { x: state.pointer.x - state.origin.x, y: state.pointer.y - state.origin.y };
}
