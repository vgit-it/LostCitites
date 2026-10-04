// @vitest-environment jsdom
// Day and night: which theme a tablet opens in, the pull that turns the
// cloth over, and the corner that owns that pull.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { initialTheme, otherTheme } from './platform/theme';
import { FOLD_REST_PX, PEEL_PX, foldSize, peelDistance, peelOutcome } from './table/peelGesture';
import { ClothCorner } from './table/ClothCorner';

afterEach(cleanup);

describe('which theme a tablet opens in', () => {
  it('remembers the side the cloth was last turned to, over the device setting', () => {
    expect(initialTheme('night', false)).toBe('night');
    expect(initialTheme('day', true)).toBe('day');
  });

  it('falls back to the device setting, and ignores anything it does not recognise', () => {
    expect(initialTheme(null, true)).toBe('night');
    expect(initialTheme(null, false)).toBe('day');
    expect(initialTheme('dusk', true)).toBe('night');
  });

  it('turns over to the other side', () => {
    expect(otherTheme('day')).toBe('night');
    expect(otherTheme('night')).toBe('day');
  });
});

describe('peeling back the cloth corner', () => {
  it('counts only a pull in toward the middle of the table', () => {
    // Left and down from the top-right corner, along the diagonal.
    expect(peelDistance(-100, 100)).toBeCloseTo(100 * Math.SQRT2);
    // Along the edge, or back out past the corner: nothing.
    expect(peelDistance(50, 50)).toBe(0);
    expect(peelDistance(100, -100)).toBe(0);
  });

  it('turns the cloth only past the threshold', () => {
    expect(peelOutcome(PEEL_PX - 1)).toBe('return');
    expect(peelOutcome(PEEL_PX)).toBe('turn');
  });

  it('grows the fold with the pull, from its resting size', () => {
    expect(foldSize(0)).toBe(FOLD_REST_PX);
    expect(foldSize(100)).toBeGreaterThan(foldSize(50));
  });
});

describe('the cloth corner', () => {
  function pull(corner: HTMLElement, dx: number, dy: number): void {
    fireEvent.pointerDown(corner, { pointerId: 1, button: 0, clientX: 500, clientY: 0 });
    fireEvent.pointerMove(corner, { pointerId: 1, clientX: 500 + dx, clientY: dy });
    fireEvent.pointerUp(corner, { pointerId: 1, clientX: 500 + dx, clientY: dy });
  }

  it('turns the cloth over on a long enough diagonal pull', () => {
    const onTurn = vi.fn();
    render(<ClothCorner theme="day" onTurn={onTurn} />);
    pull(screen.getByLabelText('Turn the cloth over to night'), -120, 120);
    expect(onTurn).toHaveBeenCalledTimes(1);
  });

  it('springs back from a short pull, and never turns on a tap', () => {
    const onTurn = vi.fn();
    render(<ClothCorner theme="night" onTurn={onTurn} />);
    const corner = screen.getByLabelText('Turn the cloth over to day');
    pull(corner, -30, 30);
    fireEvent.click(corner, { detail: 1 });
    expect(onTurn).not.toHaveBeenCalled();
  });

  it('turns from the keyboard', () => {
    const onTurn = vi.fn();
    render(<ClothCorner theme="day" onTurn={onTurn} />);
    fireEvent.click(screen.getByLabelText('Turn the cloth over to night'), { detail: 0 });
    expect(onTurn).toHaveBeenCalledTimes(1);
  });
});
