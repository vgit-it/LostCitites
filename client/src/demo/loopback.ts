// ============================================================
// A Connection and a SocketClient wired to each other in one heap.
//
// server/transport.ts types its seam on raw strings so that nothing above
// it knows what a socket is. wsTransport.ts is one implementation of that
// interface; this is another, for the case where the server is running in
// the same tab as the client.
//
// No React, no game knowledge — it moves strings one way and typed
// messages the other, exactly like socket.ts does over a real WebSocket.
// ============================================================

import { ClientMessage, ServerMessage } from '@shared/types';
import type { Connection } from '../../../server/transport';
import { ConnectionStatus, SocketClient } from '../session/socket';

export interface Loopback {
  /** Give this to the client (session store). */
  socket: SocketClient;
  /** Give this to the server (handleConnection). */
  connection: Connection;
}

export interface LoopbackOptions {
  /**
   * Deliver inside the caller's stack instead of on a microtask.
   *
   * Off by default, and that default is load-bearing: a real socket never
   * lands a reply in the caller's own stack, so a synchronous default would
   * let a tap re-enter React mid-update and the demo would quietly behave
   * better than the LAN build it exists to represent.
   *
   * On for the scenario fast-forward only, which is a replay rather than a
   * session — pumping forty turns through a microtask queue would buy
   * nothing and would force every demo route to mount a loading state.
   */
  sync?: boolean;
}

export function createLoopback({ sync = false }: LoopbackOptions = {}): Loopback {
  const later = sync ? (fn: () => void) => fn() : queueMicrotask;

  const messageHandlers = new Set<(message: ServerMessage) => void>();
  const statusHandlers = new Set<(status: ConnectionStatus) => void>();
  const openHandlers = new Set<() => void>();

  let serverMessageHandler: ((raw: string) => void) | null = null;
  let serverCloseHandler: (() => void) | null = null;
  let status: ConnectionStatus = 'open';

  function setStatus(next: ConnectionStatus): void {
    if (status === next) return;
    status = next;
    for (const handler of statusHandlers) handler(next);
  }

  const socket: SocketClient = {
    send(message: ClientMessage) {
      if (status !== 'open') return;
      const raw = JSON.stringify(message);
      later(() => serverMessageHandler?.(raw));
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onStatusChange(handler) {
      statusHandlers.add(handler);
      return () => statusHandlers.delete(handler);
    },
    onOpen(handler) {
      openHandlers.add(handler);
      return () => openHandlers.delete(handler);
    },
    getStatus: () => status,
    close() {
      setStatus('closed');
      later(() => serverCloseHandler?.());
    },
  };

  const connection: Connection = {
    send(raw: string) {
      if (status !== 'open') return;
      later(() => {
        let message: ServerMessage;
        try {
          message = JSON.parse(raw) as ServerMessage;
        } catch {
          return;
        }
        for (const handler of messageHandlers) handler(message);
      });
    },
    onMessage(handler) {
      serverMessageHandler = handler;
    },
    onClose(handler) {
      serverCloseHandler = handler;
    },
    close() {
      setStatus('closed');
      later(() => serverCloseHandler?.());
    },
  };

  // The session store re-sends its join on every open, which is what makes
  // reconnect transparent. Fire once so a freshly attached client joins.
  //
  // Always on a microtask, even in sync mode: the caller cannot have
  // registered a handler yet, since it does not hold the socket until this
  // function returns. Sync peers do not rely on this — they join explicitly.
  queueMicrotask(() => {
    for (const handler of openHandlers) handler();
  });

  return { socket, connection };
}
