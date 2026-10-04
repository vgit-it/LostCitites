// ============================================================
// Day and night, isolated so components never touch matchMedia,
// localStorage or <html> directly — the same reason wakeLock.ts exists.
//
// Only the tablet calls useTableTheme(). It sets data-theme on <html>
// explicitly, so its own choice (turned over with the cloth corner) wins
// over the device setting. A phone never sets it and follows its device
// through the prefers-color-scheme block in tokens.css.
// ============================================================

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'day' | 'night';

const KEY = 'lostcities.tableTheme';

/**
 * The theme a tablet opens in: the one it was last turned to, else the
 * device's own dark-mode setting. Pure, so the precedence is testable.
 */
export function initialTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === 'day' || stored === 'night') return stored;
  return prefersDark ? 'night' : 'day';
}

export function otherTheme(theme: Theme): Theme {
  return theme === 'day' ? 'night' : 'day';
}

function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

// Storage can throw (private mode, blocked site data) or be absent; the
// theme is a convenience, so either just means "not remembered".
function readStored(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function writeStored(theme: Theme): void {
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    // Not remembered across a refresh; still applied for this session.
  }
}

/** The tablet's theme, applied to <html>, and the turn that flips it. */
export function useTableTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => initialTheme(readStored(), prefersDark()));

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    return () => {
      delete root.dataset.theme;
    };
  }, [theme]);

  const turn = useCallback(() => {
    setTheme((current) => {
      const next = otherTheme(current);
      writeStored(next);
      return next;
    });
  }, []);

  return [theme, turn];
}
