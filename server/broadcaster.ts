// ============================================================
// Role vocabulary and the send contract that room.ts depends on.
//
// Types only — the concrete implementation lives in roomBroadcaster.ts,
// so Room and its unit tests can depend on this file without pulling in
// `ws` or any real socket.
// ============================================================

import { ClientView, Seat, TableEvent } from '@shared/types';
import type { Connection } from './transport';

export type ClientRole = 'table' | 'seat0' | 'seat1';

export const ALL_ROLES: readonly ClientRole[] = ['table', 'seat0', 'seat1'];

export function roleOfSeat(seat: Seat): ClientRole {
  return seat === 0 ? 'seat0' : 'seat1';
}

/** null for the table, which holds no seat. */
export function seatOfRole(role: ClientRole): Seat | null {
  if (role === 'seat0') return 0;
  if (role === 'seat1') return 1;
  return null;
}

/** What Room is allowed to do with the outside world. Nothing else. */
export interface Broadcaster {
  sendState(role: ClientRole, view: ClientView): void;
  sendError(role: ClientRole, message: string): void;
  sendEvent(role: ClientRole, event: TableEvent): void;
}

/** Attaching live connections to roles. Owned by the router, not by Room. */
export interface RoleBinder {
  bind(role: ClientRole, connection: Connection): void;
  unbind(role: ClientRole): void;
  /**
   * The connection currently bound to `role`, if any. The router compares
   * against this before acting on a close, so a stale socket dying after a
   * reconnect cannot mark the fresh one disconnected.
   */
  boundConnection(role: ClientRole): Connection | null;
}

/** One room's outbound channel: send to roles, and manage who those roles are. */
export interface RoomChannel extends Broadcaster, RoleBinder {}
