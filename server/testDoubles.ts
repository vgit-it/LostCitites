// ============================================================
// Test doubles for the two I/O seams. Kept in one place so room, registry,
// and router tests all drive the same fakes.
// ============================================================

import { ClientView, ServerMessage, TableEvent } from '@shared/types';
import { ClientRole, RoomChannel } from './broadcaster';
import { Connection } from './transport';

/** Records everything Room sends, so assertions read off arrays. */
export class FakeChannel implements RoomChannel {
  readonly states: { role: ClientRole; view: ClientView }[] = [];
  readonly errors: { role: ClientRole; message: string }[] = [];
  readonly events: { role: ClientRole; event: TableEvent }[] = [];

  private readonly bound = new Map<ClientRole, Connection>();

  bind(role: ClientRole, connection: Connection): void {
    this.bound.set(role, connection);
  }
  unbind(role: ClientRole): void {
    this.bound.delete(role);
  }
  boundConnection(role: ClientRole): Connection | null {
    return this.bound.get(role) ?? null;
  }

  sendState(role: ClientRole, view: ClientView): void {
    this.states.push({ role, view });
  }
  sendError(role: ClientRole, message: string): void {
    this.errors.push({ role, message });
  }
  sendEvent(role: ClientRole, event: TableEvent): void {
    this.events.push({ role, event });
  }

  /** The most recent view sent to a role, which is what a client would be showing. */
  latest(role: ClientRole): ClientView | undefined {
    for (let i = this.states.length - 1; i >= 0; i--) {
      if (this.states[i].role === role) return this.states[i].view;
    }
    return undefined;
  }

  /**
   * Drops recorded errors and cues but keeps the states, so a test can reset
   * its expectations after setup while still reading the current views.
   */
  clearSignals(): void {
    this.errors.length = 0;
    this.events.length = 0;
  }

  clear(): void {
    this.states.length = 0;
    this.clearSignals();
  }
}

/** A Connection that captures raw frames and lets a test push frames in. */
export class FakeConnection implements Connection {
  readonly sent: string[] = [];
  closed = false;

  private messageHandler: ((raw: string) => void) | null = null;
  private closeHandler: (() => void) | null = null;

  send(raw: string): void {
    this.sent.push(raw);
  }
  onMessage(handler: (raw: string) => void): void {
    this.messageHandler = handler;
  }
  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }
  close(): void {
    this.closed = true;
    this.closeHandler?.();
  }

  /** Simulate the client sending a message. */
  emit(message: unknown): void {
    this.messageHandler?.(typeof message === 'string' ? message : JSON.stringify(message));
  }

  /** Everything this connection received, parsed. */
  received(): ServerMessage[] {
    return this.sent.map((raw) => JSON.parse(raw) as ServerMessage);
  }

  /** The most recent `state` frame's view, i.e. what this client is showing. */
  latestView(): Extract<ServerMessage, { t: 'state' }>['view'] | undefined {
    const states = this.received().filter((m) => m.t === 'state');
    return states.length > 0 ? states[states.length - 1].view : undefined;
  }

  errors(): string[] {
    return this.received().flatMap((m) => (m.t === 'error' ? [m.message] : []));
  }
}
