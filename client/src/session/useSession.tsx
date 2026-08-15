// ============================================================
// The only bridge between the session store and React.
// Components use these hooks; nothing else imports session.ts or socket.ts.
// ============================================================

import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { ClientView, TableEvent } from '@shared/types';
import { SessionStore } from './session';
import { ConnectionStatus } from './socket';

const SessionContext = createContext<SessionStore | null>(null);

export function SessionProvider({
  store,
  children,
}: {
  store: SessionStore;
  children: React.ReactNode;
}) {
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionStore {
  const store = useContext(SessionContext);
  if (!store) throw new Error('useSession must be used inside a SessionProvider');
  return store;
}

export function useClientView(): ClientView | null {
  const store = useSession();
  return useSyncExternalStore(store.subscribe, store.getView, store.getView);
}

export function useConnectionStatus(): ConnectionStatus {
  const store = useSession();
  return useSyncExternalStore(store.subscribe, store.getStatus, store.getStatus);
}

export function useSessionError(): string | null {
  const store = useSession();
  return useSyncExternalStore(store.subscribe, store.getError, store.getError);
}

/**
 * Bumps on every server reply, state or error alike — unlike `getError`,
 * which can hold the same string across two refusals in a row and so never
 * re-fires the effects keyed on it. Read this when what matters is "a reply
 * arrived", not "what it said".
 */
export function useServerSeq(): number {
  const store = useSession();
  return useSyncExternalStore(store.subscribe, store.getSeq, store.getSeq);
}

/** Cosmetic cues only. Never derive state from these. */
export function useTableEvents(handler: (event: TableEvent) => void): void {
  const store = useSession();
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => store.onTableEvent((event) => latest.current(event)), [store]);
}
