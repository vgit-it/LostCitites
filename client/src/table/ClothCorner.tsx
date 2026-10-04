// The folded-back corner of the tablecloth: pull it in toward the middle of
// the table to turn the cloth over, from day to night and back. The gesture
// arithmetic lives in peelGesture.ts; this owns only the pointer events.

import { useRef, useState } from 'react';
import { Theme } from '../platform/theme';
import { foldSize, peelDistance, peelOutcome } from './peelGesture';

export interface ClothCornerProps {
  theme: Theme;
  onTurn: () => void;
}

export function ClothCorner({ theme, onTurn }: ClothCornerProps) {
  /** Distance pulled so far, or null when nobody is holding the corner. */
  const [pull, setPull] = useState<number | null>(null);
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    // The table's own pointerdown still runs (it unlocks sound); only the
    // gesture is ours.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    origin.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    setPull(0);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>): void {
    const start = origin.current;
    if (!start || event.pointerId !== start.id) return;
    setPull(peelDistance(event.clientX - start.x, event.clientY - start.y));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLButtonElement>): void {
    const start = origin.current;
    if (!start || event.pointerId !== start.id) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    origin.current = null;
    const turned =
      event.type !== 'pointercancel' &&
      peelOutcome(peelDistance(event.clientX - start.x, event.clientY - start.y)) === 'turn';
    setPull(null);
    if (turned) onTurn();
  }

  const label = theme === 'day' ? 'Turn the cloth over to night' : 'Turn the cloth over to day';

  return (
    <button
      type="button"
      className={`cloth-corner${pull !== null ? ' is-peeling' : ''}`}
      style={pull !== null ? ({ '--fold': `${foldSize(pull)}px` } as React.CSSProperties) : undefined}
      aria-label={label}
      title={label}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      // Keyboard only: Enter and Space arrive with detail 0. A pointer click
      // must never turn the cloth — that is exactly the tap this table
      // refuses — so it is left to the pull above.
      onClick={(event) => {
        if (event.detail === 0) onTurn();
      }}
    />
  );
}
