// ============================================================
// Motion, isolated so components never touch matchMedia or the Web
// Animations API directly — the same reason vibrate.ts and wakeLock.ts
// exist.
//
// Two things make this file load-bearing rather than a convenience:
//
//   1. The CSS `prefers-reduced-motion` blanket in tokens.css cannot reach
//      a WAAPI animation. Durations driven from JS have to check for
//      themselves, and they check here.
//   2. jsdom implements no layout and no `Element.animate`. Guarding once
//      here keeps every component that animates renderable under test
//      without a global setup file.
// ============================================================

/**
 * Durations for JS-driven motion. CSS mirrors these as --motion-flight and
 * friends, but TS is the source of truth: WAAPI cannot read a custom
 * property, so the duplication is unavoidable — keep the two in step.
 */
export const FLIGHT_MS = 260;
export const LAND_MS = 180;
export const DRAW_FLIGHT_MS = 240;

/** The app's one easing curve, matching cubic-bezier(0.2, 0.7, 0.3, 1). */
export const EASE = 'cubic-bezier(0.2, 0.7, 0.3, 1)';

export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Run a WAAPI animation, resolving when it finishes.
 *
 * Resolves immediately where `Element.animate` is missing (jsdom), and
 * collapses the duration to zero under reduced motion so the caller's
 * end-state still applies without the travel. Never rejects: a cancelled
 * animation — the element unmounted mid-flight — is a normal outcome here,
 * not an error, and callers use this to sequence UI state.
 */
export function animate(
  el: Element,
  frames: Keyframe[],
  opts: KeyframeAnimationOptions,
): Promise<void> {
  const target = el as HTMLElement;
  if (typeof target.animate !== 'function') return Promise.resolve();

  return target
    .animate(frames, { ...opts, duration: prefersReducedMotion() ? 0 : opts.duration })
    .finished.then(() => undefined)
    .catch(() => undefined);
}
