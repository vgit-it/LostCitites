// ============================================================
// Protocol dispatch. Resolves a connection to a role and a room, then
// forwards intents to Room methods.
//
// Contains no rules logic (rules.ts owns that, called inside Room) and
// no outbound serialization beyond the pre-join error case, where no
// channel exists yet to send through.
// ============================================================

import { ClientMessage, Seat } from '@shared/types';
import { ClientRole, roleOfSeat, seatOfRole } from './broadcaster';
import { RoomEntry, RoomRegistry } from './registry';
import { sendTo } from './roomBroadcaster';
import { Connection } from './transport';

interface ConnectionContext {
  readonly connection: Connection;
  readonly registry: RoomRegistry;
  entry: RoomEntry | null;
  role: ClientRole | null;
}

export function handleConnection(connection: Connection, registry: RoomRegistry): void {
  const ctx: ConnectionContext = { connection, registry, entry: null, role: null };

  connection.onMessage((raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return fail(ctx, 'Malformed message.');
    }
    dispatch(ctx, message);
  });

  connection.onClose(() => {
    if (!ctx.entry || !ctx.role) return;
    // A stale socket dying after this role was rebound must not mark the
    // fresh connection disconnected.
    if (ctx.entry.channel.boundConnection(ctx.role) !== connection) return;

    ctx.entry.channel.unbind(ctx.role);
    ctx.entry.room.unbind(ctx.role);
  });
}

function dispatch(ctx: ConnectionContext, message: ClientMessage): void {
  switch (message.t) {
    case 'joinTable':
      return joinTable(ctx, message.code);

    case 'joinPlayer':
      return joinPlayer(ctx, message.code, message.seat, message.name);

    case 'startRound': {
      if (!ctx.entry) return fail(ctx, 'Join a game first.');
      return ctx.entry.room.startRound();
    }

    case 'place': {
      const seat = requireSeat(ctx);
      if (seat === null) return;
      return ctx.entry!.room.place(seat, message.cardId, message.target);
    }

    case 'draw': {
      const seat = requireSeat(ctx);
      if (seat === null) return;
      return ctx.entry!.room.draw(seat, message.source);
    }

    case 'readyNextRound': {
      const seat = requireSeat(ctx);
      if (seat === null) return;
      return ctx.entry!.room.readyNextRound(seat);
    }
  }
}

/**
 * The tablet claims the table, supplying the code it is displaying. An
 * unknown code mints the room under that code, so a refreshed tablet
 * re-claims the room it was already showing rather than orphaning it.
 */
function joinTable(ctx: ConnectionContext, code: string): void {
  const entry = (code ? ctx.registry.get(code) : undefined) ?? ctx.registry.create(code);
  bind(ctx, entry, 'table');
  entry.room.bindTable();
}

function joinPlayer(ctx: ConnectionContext, code: string, seat: Seat, name: string): void {
  if (seat !== 0 && seat !== 1) return fail(ctx, 'Invalid seat.');

  const entry = ctx.registry.get(code);
  if (!entry) return fail(ctx, `No game with code ${code}.`);

  bind(ctx, entry, roleOfSeat(seat));
  entry.room.bindPlayer(seat, name);
}

function bind(ctx: ConnectionContext, entry: RoomEntry, role: ClientRole): void {
  // Leaving one role for another (a refreshed device re-joining) must not
  // leave the old role still pointing at this socket.
  if (ctx.entry && ctx.role && ctx.entry.channel.boundConnection(ctx.role) === ctx.connection) {
    ctx.entry.channel.unbind(ctx.role);
  }

  ctx.entry = entry;
  ctx.role = role;
  entry.channel.bind(role, ctx.connection);
}

function requireSeat(ctx: ConnectionContext): Seat | null {
  if (!ctx.entry) {
    fail(ctx, 'Join a game first.');
    return null;
  }

  const seat = ctx.role ? seatOfRole(ctx.role) : null;
  if (seat === null) {
    fail(ctx, 'The table cannot take turns.');
    return null;
  }
  return seat;
}

/** Errors raised before a role exists have no channel to go through. */
function fail(ctx: ConnectionContext, message: string): void {
  if (ctx.entry && ctx.role) ctx.entry.channel.sendError(ctx.role, message);
  else sendTo(ctx.connection, { t: 'error', message });
}
