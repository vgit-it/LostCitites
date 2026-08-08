// ============================================================
// Haptics, isolated so components never touch navigator directly.
//
// The highest-value quality-of-life feature in the build: phones sleep
// during the opponent's turn, and the buzz lands even with the screen off.
// ============================================================

const TURN_START_MS = 200;

export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function vibrateTurnStart(): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(TURN_START_MS);
  } catch {
    // iOS Safari has no vibrate at all; nothing to fall back to.
  }
}
