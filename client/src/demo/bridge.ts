// ============================================================
// Connection over postMessage, so a pane in an iframe can play the game
// running in its parent.
//
// The third implementation of server/transport.ts's Connection, after `ws`
// and the loopback. Same seam, same raw strings — a window boundary instead
// of a socket or a function call.
//
// Why iframes at all, when three panes could be three React trees on one
// page: media queries and viewport units resolve against the *window*. A
// phone pane on a desktop window would pick up .rotate-gate's landscape
// branch regardless of the pane's own width and height, so the harness
// would be showing something the phone never shows. An iframe is a real
// viewport. It also means a pane and a standalone route run identical code.
// ============================================================

import { ClientMessage, ServerMessage } from '@shared/types';
import type { Connection } from '../../../server/transport';
import { ConnectionStatus, SocketClient } from '../session/socket';

/** Envelope tag, so the panes ignore postMessage traffic that is not ours. */
const TAG = 'lost-cities-demo';

type Frame =
  | { tag: typeof TAG; kind: 'ready'; id: string }
  | { tag: typeof TAG; kind: 'up'; id: string; raw: string }
  | { tag: typeof TAG; kind: 'down'; id: string; raw: string }
  /** The server went away. Models a dropped socket, for the kill switch. */
  | { tag: typeof TAG; kind: 'closed'; id: string };

function isFrame(data: unknown): data is Frame {
  return typeof data === 'object' && data !== null && (data as Frame).tag === TAG;
}

/** The minimum of a Window this module needs, so tests need no real frames. */
export interface MessagePort {
  postMessage(data: unknown, targetOrigin: string): void;
  addEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
}

// ------------------------------------------------------------
// Parent side — hands the server a Connection per pane
// ------------------------------------------------------------

export interface BridgeHost {
  /**
   * Called with a fresh Connection each time a pane announces itself.
   * A pane that reloads announces again and gets a new one, which is
   * exactly what a reconnecting socket looks like from here.
   */
  stop(): void;
}

export function hostBridge(
  self: MessagePort,
  frameFor: (id: string) => MessagePort | null,
  onConnection: (connection: Connection, id: string) => void,
  origin: string,
): BridgeHost {
  const handler = (event: MessageEvent) => {
    if (!isFrame(event.data)) return;
    const frame = event.data;

    if (frame.kind === 'ready') {
      const target = frameFor(frame.id);
      if (target) onConnection(connectionTo(self, target, frame.id, origin), frame.id);
      return;
    }
  };

  self.addEventListener('message', handler);
  return { stop: () => self.removeEventListener('message', handler) };
}

/** The server's end of one pane's connection. */
function connectionTo(
  self: MessagePort,
  target: MessagePort,
  id: string,
  origin: string,
): Connection {
  let messageHandler: ((raw: string) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  let open = true;

  const listener = (event: MessageEvent) => {
    if (!isFrame(event.data) || event.data.id !== id) return;
    if (event.data.kind === 'up' && open) messageHandler?.(event.data.raw);
    // A pane announcing itself again means it reloaded: the old connection
    // is dead, and the router must be told or the role stays bound to it.
    if (event.data.kind === 'ready' && open) {
      open = false;
      self.removeEventListener('message', listener);
      closeHandler?.();
    }
  };
  self.addEventListener('message', listener);

  return {
    send(raw) {
      if (!open) return;
      target.postMessage({ tag: TAG, kind: 'down', id, raw } satisfies Frame, origin);
    },
    onMessage(handler) {
      messageHandler = handler;
    },
    onClose(handler) {
      closeHandler = handler;
    },
    close() {
      if (!open) return;
      open = false;
      self.removeEventListener('message', listener);
      target.postMessage({ tag: TAG, kind: 'closed', id } satisfies Frame, origin);
      closeHandler?.();
    },
  };
}

// ------------------------------------------------------------
// Pane side — a SocketClient that talks to the parent
// ------------------------------------------------------------

export function createBridgeSocket(
  self: MessagePort,
  parent: MessagePort,
  id: string,
  origin: string,
): SocketClient {
  const messageHandlers = new Set<(message: ServerMessage) => void>();
  const statusHandlers = new Set<(status: ConnectionStatus) => void>();
  const openHandlers = new Set<() => void>();
  let status: ConnectionStatus = 'open';

  function setStatus(next: ConnectionStatus): void {
    if (status === next) return;
    status = next;
    for (const handler of statusHandlers) handler(next);
  }

  const listener = (event: MessageEvent) => {
    if (!isFrame(event.data) || event.data.id !== id) return;

    // 'reconnecting' rather than 'closed': from the pane's side a server
    // that stops answering is indistinguishable from one that will come
    // back, and that is the state the reconnect bar is meant to show.
    if (event.data.kind === 'closed') return setStatus('reconnecting');
    if (event.data.kind !== 'down') return;

    let message: ServerMessage;
    try {
      message = JSON.parse(event.data.raw) as ServerMessage;
    } catch {
      return;
    }
    for (const handler of messageHandlers) handler(message);
  };
  self.addEventListener('message', listener);

  // Announce after the caller has had a chance to register onOpen — the
  // session store re-sends its join there, and that is what seats the pane.
  queueMicrotask(() => {
    parent.postMessage({ tag: TAG, kind: 'ready', id } satisfies Frame, origin);
    for (const handler of openHandlers) handler();
  });

  return {
    send(message: ClientMessage) {
      if (status !== 'open') return;
      parent.postMessage(
        { tag: TAG, kind: 'up', id, raw: JSON.stringify(message) } satisfies Frame,
        origin,
      );
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
      self.removeEventListener('message', listener);
      setStatus('closed');
    },
  };
}
