// Asking the browser to stay in landscape.
//
// Best-effort by design. Screen Orientation locking is only permitted from a
// fullscreen or installed context, so on an ordinary browser tab this does
// nothing at all and that is fine: the layout's own portrait branch is what
// actually handles a sideways phone. This is the bonus for a player who has
// added the game to their home screen.
//
// Lives here because platform/ is the only place allowed to touch `screen`
// and `navigator`.

import { useEffect } from 'react';

interface LockableOrientation {
  lock?: (orientation: string) => Promise<void>;
}

export function lockLandscape(): void {
  const orientation = (screen as unknown as { orientation?: LockableOrientation }).orientation;
  // A rejected promise here is the normal case, not an error worth surfacing.
  void orientation?.lock?.('landscape').catch(() => undefined);
}

export function useLandscapeLock(enabled = true): void {
  useEffect(() => {
    if (enabled) lockLandscape();
  }, [enabled]);
}
