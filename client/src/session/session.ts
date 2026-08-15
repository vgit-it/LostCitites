// ============================================================
// The seam that keeps every component off the wire.
//
// Owns the current ClientView and exposes intents. Components read a view
// and call actions; they never see a socket, a message type, or a retry.
//
// Events are delivered to subscribers but never folded into the view —
// state is the source of truth, cues are cosmetic (BUILD_SPEC §5).
// ============================================================

import {
  ClientView,
  DrawSource,
  PlaceTarget,
  Seat,
  ServerMessage,
  TableEvent,
} from '@shared/types';
import { RejoinInfo, RejoinStore } from './rejoinStore';
import { ConnectionStatus, SocketClient } from './socket';

export interface SessionStore {
  getView(): ClientView | null;
  getStatus(): ConnectionStatus;
  /** Most recent server error, for the toast. Cleared by dismissError(). */
  getError(): string | null;
  dismissError(): void;
  /** The code this device is using, once it has joined. */
  getCode(): string | null;
  /**
   * Bumped on every `state` and `error` reply from the server — a rejection
   * is as much a reply as a state. A component that only reacts to `getView`
   * changing has no signal a refusal ever happened at all, since `error`
   * alone can repeat the same string twice in a row and nothing else moves.
   */
  getSeq(): number;

  subscribe(listener: () => void): () => void;
  onTableEvent(handler: (event: TableEvent) => void): () => void;

  joinTable(code: string): void;
  joinPlayer(code: string, seat: Seat, name: string): void;
  startRound(): void;
  place(cardId: string, target: PlaceTarget['kind']): void;
  draw(source: DrawSource): void;
  readyNextRound(): void;
  /** Forget this device's seat, e.g. to join a different game. */
  leave(): void;
}

export function createSessionStore(socket: SocketClient, rejoin: RejoinStore): SessionStore {
  const listeners = new Set<() => void>();
  const eventHandlers = new Set<(event: TableEvent) => void>();

  let view: ClientView | null = null;
  let status: ConnectionStatus = socket.getStatus();
  let error: string | null = null;
  let seq = 0;
  let membership: RejoinInfo | null = rejoin.load();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  /** Re-sent on every (re)connection, which is what makes reconnect transparent. */
  function sendJoin(): void {
    if (!membership) return;
    if (membership.role === 'table') {
      socket.send({ t: 'joinTable', code: membership.code });
    } else if (membership.seat !== undefined) {
      socket.send({
        t: 'joinPlayer',
        code: membership.code,
        seat: membership.seat,
        name: membership.name ?? '',
      });
    }
  }

  function remember(info: RejoinInfo): void {
    membership = info;
    rejoin.save(info);
    sendJoin();
    notify();
  }

  socket.onMessage((message: ServerMessage) => {
    switch (message.t) {
      case 'state':
        view = message.view;
        error = null;
        seq += 1;
        return notify();
      case 'error':
        error = message.message;
        seq += 1;
        return notify();
      case 'event':
        // Deliberately does not touch `view`.
        for (const handler of eventHandlers) handler(message.kind);
        return;
    }
  });

  socket.onStatusChange((next) => {
    status = next;
    notify();
  });

  socket.onOpen(sendJoin);

  return {
    getView: () => view,
    getStatus: () => status,
    getError: () => error,
    getCode: () => membership?.code ?? null,
    getSeq: () => seq,

    dismissError() {
      if (error === null) return;
      error = null;
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    onTableEvent(handler) {
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    },

    joinTable: (code) => remember({ code, role: 'table' }),
    joinPlayer: (code, seat, name) => remember({ code, role: 'player', seat, name }),

    startRound: () => socket.send({ t: 'startRound' }),
    place: (cardId, target) => socket.send({ t: 'place', cardId, target }),
    draw: (source) => socket.send({ t: 'draw', source }),
    readyNextRound: () => socket.send({ t: 'readyNextRound' }),

    leave() {
      membership = null;
      view = null;
      rejoin.clear();
      notify();
    },
  };
}
