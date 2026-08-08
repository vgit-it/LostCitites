// ============================================================
// Reconnecting WebSocket wrapper. The only client file that touches the
// browser WebSocket global.
//
// No React, no localStorage, no view state — it moves typed protocol
// messages in both directions and reports connection status.
// ============================================================

import { ClientMessage, ServerMessage } from '@shared/types';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SocketClient {
  send(message: ClientMessage): void;
  onMessage(handler: (message: ServerMessage) => void): () => void;
  onStatusChange(handler: (status: ConnectionStatus) => void): () => void;
  /** Fires on every (re)connection, so callers can re-send their join. */
  onOpen(handler: () => void): () => void;
  getStatus(): ConnectionStatus;
  close(): void;
}

/** Fixed retry, no backoff. This is a LAN — the server is either there or it isn't. */
const RETRY_MS = 1000;

export function defaultSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function createSocketClient(url: string = defaultSocketUrl()): SocketClient {
  const messageHandlers = new Set<(message: ServerMessage) => void>();
  const statusHandlers = new Set<(status: ConnectionStatus) => void>();
  const openHandlers = new Set<() => void>();

  let socket: WebSocket | null = null;
  let status: ConnectionStatus = 'connecting';
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let closedByCaller = false;
  /** Queued while down, flushed on open — a tap during a blip is not lost. */
  let pending: ClientMessage[] = [];

  function setStatus(next: ConnectionStatus): void {
    if (status === next) return;
    status = next;
    for (const handler of statusHandlers) handler(next);
  }

  function connect(): void {
    socket = new WebSocket(url);

    socket.addEventListener('open', () => {
      setStatus('open');
      const queued = pending;
      pending = [];
      for (const message of queued) socket?.send(JSON.stringify(message));
      for (const handler of openHandlers) handler();
    });

    socket.addEventListener('message', (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      for (const handler of messageHandlers) handler(message);
    });

    socket.addEventListener('close', () => {
      if (closedByCaller) return setStatus('closed');
      setStatus('reconnecting');
      retryTimer = setTimeout(connect, RETRY_MS);
    });

    // 'error' is always followed by 'close', which owns the retry.
    socket.addEventListener('error', () => socket?.close());
  }

  connect();

  return {
    send(message) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      else pending.push(message);
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
      closedByCaller = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    },
  };
}
