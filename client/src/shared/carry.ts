// The feel of a card carried under a finger.
//
// Pure — no DOM, no timers, no React. The same reason columnMetrics lives
// alone: this is the arithmetic that decides whether a gesture feels like a
// card or like a div, and it is only checkable if it can be called with
// numbers.
//
// Shared, because both devices carry cards now: the phone lifts one out of
// the hand, and the table lifts one off a discard pile. What each does with
// the release is its own business and lives next to it — phone/throw.ts and
// table/drawGesture.ts.

export interface Point {
  x: number;
  y: number;
}

// ------------------------------------------------------------
// Following the finger
// ------------------------------------------------------------

/**
 * How much of the gap to the finger a card closes in one 60fps frame.
 *
 * Not 1. A card welded to the pointer reads as a cursor; a card that trails
 * slightly reads as an object with weight being dragged. The trailing distance
 * is also what the tilt is computed from, so this one number sets both.
 */
export const FOLLOW_PER_FRAME = 0.24;

const FRAME_MS = 1000 / 60;

/**
 * How far the card floats above the finger while carried.
 *
 * A card centred on the thumb is a card you cannot see. Holding it clear
 * above the contact point is what makes "picked up" legible, and it is what
 * hands do with real cards.
 */
export const CARRY_LIFT_PX = 54;

/**
 * One step of the follow, framerate-independent.
 *
 * Exponential smoothing rather than a fixed fraction per call: a frame that
 * arrives late must cover the ground it missed, or the card falls further
 * behind the slower the device is — exactly backwards.
 */
export function followStep(current: Point, target: Point, dtMs: number): Point {
  if (dtMs <= 0) return current;
  const k = 1 - Math.pow(1 - FOLLOW_PER_FRAME, dtMs / FRAME_MS);
  return {
    x: current.x + (target.x - current.x) * k,
    y: current.y + (target.y - current.y) * k,
  };
}

/** Past this the card is close enough that another frame would not show. */
export const SETTLED_PX = 0.5;

export function isSettled(current: Point, target: Point): boolean {
  return Math.abs(target.x - current.x) < SETTLED_PX && Math.abs(target.y - current.y) < SETTLED_PX;
}

// ------------------------------------------------------------
// Tilt
// ------------------------------------------------------------

export const MAX_TILT_DEG = 16;
const TILT_PER_PX = 0.42;

/**
 * How far the card turns, from how far it is trailing its finger.
 *
 * Straight out of the lag, with no state of its own: swing the hand right and
 * the card is left of the thumb and rotates as if dragged from one corner.
 * Stop, the lag closes, and the card levels off by itself.
 */
export function tiltFor(lagX: number): number {
  const deg = lagX * TILT_PER_PX;
  return Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, deg));
}

// ------------------------------------------------------------
// Velocity
// ------------------------------------------------------------

export interface Sample {
  x: number;
  t: number;
}

/**
 * Only the tail of the gesture counts. A hand that swept across the screen and
 * then paused before lifting off has thrown nothing, and averaging the whole
 * drag would call that a flick.
 */
export const VELOCITY_WINDOW_MS = 90;

/** Horizontal speed in px/ms, signed. Zero when there is nothing recent. */
export function velocityFrom(samples: Sample[]): number {
  if (samples.length < 2) return 0;

  const last = samples[samples.length - 1];
  const first = samples.find((s) => last.t - s.t <= VELOCITY_WINDOW_MS);
  if (!first || first === last) return 0;

  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

/** Drops samples that have aged out, so the window stays bounded. */
export function trimSamples(samples: Sample[], now: number): Sample[] {
  return samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS);
}

// ------------------------------------------------------------
// Committing
// ------------------------------------------------------------

/**
 * px/ms. A flick: fast enough that distance stops mattering.
 *
 * 1000px/s, and the height of the bar is the point. An unhurried drag runs at
 * 300–800px/s, and it is *instantaneous* speed being measured here, so a
 * threshold much below this would read the middle of an ordinary careful drag
 * as a throw. Slow, deliberate gestures are what the distance thresholds are
 * for, and each device sets its own.
 */
export const FLICK_V = 1;
