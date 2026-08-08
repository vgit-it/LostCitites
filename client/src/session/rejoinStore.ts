// ============================================================
// What a device needs to re-claim its place after a refresh or a sleep.
// Behind an interface so the session store can be tested without jsdom's
// localStorage, and so a device can opt out of persistence entirely.
// ============================================================

import { Seat } from '@shared/types';

export interface RejoinInfo {
  code: string;
  role: 'table' | 'player';
  seat?: Seat;
  name?: string;
}

export interface RejoinStore {
  save(info: RejoinInfo): void;
  load(): RejoinInfo | null;
  clear(): void;
}

const KEY = 'lost-cities.rejoin';

function isRejoinInfo(value: unknown): value is RejoinInfo {
  if (typeof value !== 'object' || value === null) return false;
  const info = value as Partial<RejoinInfo>;
  if (typeof info.code !== 'string') return false;
  if (info.role !== 'table' && info.role !== 'player') return false;
  if (info.role === 'player' && info.seat !== 0 && info.seat !== 1) return false;
  return true;
}

export function createLocalStorageRejoinStore(): RejoinStore {
  return {
    save(info) {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(info));
      } catch {
        // Private mode or a full quota — persistence is a convenience, not a
        // requirement. The player can retype the code.
      }
    },
    load() {
      try {
        const raw = window.localStorage.getItem(KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isRejoinInfo(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    clear() {
      try {
        window.localStorage.removeItem(KEY);
      } catch {
        /* see save() */
      }
    },
  };
}

export function createInMemoryRejoinStore(initial: RejoinInfo | null = null): RejoinStore {
  let info = initial;
  return {
    save: (next) => {
      info = next;
    },
    load: () => info,
    clear: () => {
      info = null;
    },
  };
}
