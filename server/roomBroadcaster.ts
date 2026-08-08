// ============================================================
// The concrete channel: the only place outbound protocol messages are
// serialized, and the only place role -> live connection is tracked.
// No rules logic, no game state.
// ============================================================

import { ClientView, ServerMessage, TableEvent } from '@shared/types';
import { ClientRole, RoomChannel } from './broadcaster';
import { Connection } from './transport';

/** Single point of outbound serialization, shared with the router's pre-join errors. */
export function sendTo(connection: Connection, message: ServerMessage): void {
  connection.send(JSON.stringify(message));
}

export class RoomBroadcaster implements RoomChannel {
  private readonly connections = new Map<ClientRole, Connection>();

  bind(role: ClientRole, connection: Connection): void {
    this.connections.set(role, connection);
  }

  unbind(role: ClientRole): void {
    this.connections.delete(role);
  }

  boundConnection(role: ClientRole): Connection | null {
    return this.connections.get(role) ?? null;
  }

  sendState(role: ClientRole, view: ClientView): void {
    this.send(role, { t: 'state', view });
  }

  sendError(role: ClientRole, message: string): void {
    this.send(role, { t: 'error', message });
  }

  sendEvent(role: ClientRole, event: TableEvent): void {
    this.send(role, { t: 'event', kind: event });
  }

  /** An unbound role silently drops — a disconnected phone must not throw. */
  private send(role: ClientRole, message: ServerMessage): void {
    const connection = this.connections.get(role);
    if (connection) sendTo(connection, message);
  }
}
