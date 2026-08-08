// ============================================================
// Screen Wake Lock, isolated so components never touch navigator directly.
//
// Wake Lock requires a secure context. Over plain http://192.168.x.x it is
// simply unavailable, and this no-ops rather than throwing — see
// BUILD_SPEC §12 for the options (self-signed cert, or Tailscale).
// ============================================================

import { useEffect } from 'react';

type WakeLockSentinelLike = { release(): Promise<void> };
type WakeLockCapableNavigator = Navigator & {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
};

export function isWakeLockAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

/**
 * Holds a screen wake lock for the life of the component, re-acquiring it
 * when the tab comes back to the foreground (the browser drops the lock on
 * every visibility change).
 */
export function useWakeLock(enabled = true): void {
  useEffect(() => {
    if (!enabled || !isWakeLockAvailable()) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    async function acquire(): Promise<void> {
      try {
        const wakeLock = (navigator as WakeLockCapableNavigator).wakeLock;
        if (!wakeLock) return;
        const next = await wakeLock.request('screen');
        if (cancelled) return void next.release();
        sentinel = next;
      } catch {
        // Denied, or the document was hidden at request time. Not fatal —
        // the player taps the screen, and the phone still buzzes on turn.
      }
    }

    function onVisibilityChange(): void {
      if (document.visibilityState === 'visible') void acquire();
    }

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinel?.release().catch(() => undefined);
    };
  }, [enabled]);
}
