// ============================================================
// Haptics, isolated so components never touch navigator directly.
//
// The highest-value quality-of-life feature in the build: phones sleep
// during the opponent's turn, and the buzz lands even with the screen off.
//
// IMPORTANT: iOS Safari has no navigator.vibrate at all. Every haptic here
// is an *accent* on something already visible — never the only feedback for
// an action, or half the players will not know it happened.
// ============================================================

const TURN_START_MS = 200;

/** A scrub across a fanned hand crosses cards faster than the motor can
 *  answer; without a floor it machine-guns and reads as a rattle. */
const THROTTLE_MS = 40;

let lastBuzzAt = 0;

export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** Shared exit: feature check, throttle, and swallow the failure. */
function buzz(pattern: number | number[], throttled: boolean): void {
  if (!canVibrate()) return;

  if (throttled) {
    const now = Date.now();
    if (now - lastBuzzAt < THROTTLE_MS) return;
    lastBuzzAt = now;
  }

  try {
    navigator.vibrate(pattern);
  } catch {
    // Some engines expose vibrate and still refuse it (no user gesture yet).
  }
}

export function vibrateTurnStart(): void {
  buzz(TURN_START_MS, false);
}

/** One card's worth of scrub — the lightest tick the motor can place. */
export function vibrateTick(): void {
  buzz(10, true);
}

/**
 * A card has come up out of the fan and is now travelling with the thumb.
 *
 * Firmer than a tick on purpose: this is the moment a press stops being a
 * press, and it is the only signal that the hold was long enough. Without it
 * players keep holding, then drag a hand that never picked anything up.
 */
export function vibrateLift(): void {
  buzz(22, false);
}

/** Crossing into a drop zone. A tick, throttled — the thumb wanders. */
export function vibrateZone(): void {
  buzz(10, true);
}

/** A card committed to the board. The one haptic with a shape to it. */
export function vibrateCommit(): void {
  buzz([12, 40, 18], false);
}

/** A card arrived in hand. */
export function vibrateDraw(): void {
  buzz(14, false);
}

/** Refused: an illegal target, or an intent the server sent back. */
export function vibrateReject(): void {
  buzz([30, 60, 30], false);
}

/** Test seam — the throttle is module state and would otherwise leak
 *  between cases. Not called by the app. */
export function resetVibrateThrottle(): void {
  lastBuzzAt = 0;
}
