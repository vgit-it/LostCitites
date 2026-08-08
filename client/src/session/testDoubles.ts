// A SocketClient double: records what the client sent, lets a test push
// server frames back, and can simulate a drop-and-reconnect.

import { ClientMessage, ServerMessage } from '@shared/types';
import { ConnectionStatus, SocketClient } from './socket';

export class FakeSocket implements SocketClient {
  readonly sent: ClientMessage[] = [];

  private messageHandlers = new Set<(message: ServerMessage) => void>();
  private statusHandlers = new Set<(status: ConnectionStatus) => void>();
  private openHandlers = new Set<() => void>();
  private status: ConnectionStatus = 'open';

  send(message: ClientMessage): void {
    this.sent.push(message);
  }

  onMessage(handler: (message: ServerMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStatusChange(handler: (status: ConnectionStatus) => void): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  onOpen(handler: () => void): () => void {
    this.openHandlers.add(handler);
    return () => this.openHandlers.delete(handler);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  close(): void {
    this.setStatus('closed');
  }

  // ---- test controls ----

  /** Deliver a frame as though the server sent it. */
  deliver(message: ServerMessage): void {
    for (const handler of this.messageHandlers) handler(message);
  }

  setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const handler of this.statusHandlers) handler(status);
  }

  /** Socket drops and comes back, which is what fires the auto-rejoin. */
  reconnect(): void {
    this.setStatus('reconnecting');
    this.setStatus('open');
    for (const handler of this.openHandlers) handler();
  }

  lastSent(): ClientMessage | undefined {
    return this.sent[this.sent.length - 1];
  }

  clear(): void {
    this.sent.length = 0;
  }
}
