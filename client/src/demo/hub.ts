// ============================================================
// The server, running in the browser.
//
// Not a mock and not a fixture: this is server/registry.ts, server/router.ts
// and server/room.ts, unmodified, driven through the same Connection seam
// that wsTransport.ts implements over `ws`. Everything above
// server/transport.ts is pure TypeScript with no Node imports, which is what
// makes this possible at all.
//
// The consequence worth stating: a demo built on hand-written fixture views
// starts drifting from the product the day after it is written. This one
// cannot drift, because the rules, the validation and the view filtering are
// the real ones.
// ============================================================

import { InMemoryRoomRegistry } from '../../../server/registry';
import { mulberry32 } from '../../../server/rng';
import { RoomBroadcaster } from '../../../server/roomBroadcaster';
import { handleConnection } from '../../../server/router';
import type { Connection } from '../../../server/transport';
import { SocketClient } from '../session/socket';
import { createLoopback } from './loopback';

/**
 * Fixed, so a phone opened on its own can join without being told a code,
 * and so a seeded scenario is reproducible.
 *
 * It also keeps the deal deterministic for a given seed: the registry draws
 * from the same Rng it hands to Room, and honouring a preferred code means
 * code generation consumes none of it.
 */
export const DEMO_CODE = '777';

/**
 * Names for the two seats, used by both the bot and a person taking over
 * from one. Shared so the two agree: a name is server-side state, so naming
 * whoever is holding a phone "You" makes the *other* phone's banner read
 * "You is placing".
 */
export const SEAT_NAMES = ['Ada', 'Bo'] as const;

export interface DemoHub {
  readonly code: string;
  /**
   * Attach one client and return the socket to hand to createSessionStore.
   * `sync` is for the scenario fast-forward — see LoopbackOptions.
   */
  attach(options?: { sync?: boolean }): SocketClient;
  /**
   * Attach a Connection built elsewhere — the iframe bridge. The server
   * cannot tell the difference, which is the entire point of the seam.
   */
  adopt(connection: Connection): void;
  /** Every socket ever attached, for the "stop the server" control. */
  closeAll(): void;
}

export function createHub(seed: number): DemoHub {
  const registry = new InMemoryRoomRegistry(() => new RoomBroadcaster(), mulberry32(seed));

  // Eagerly, rather than on the first joinTable. A phone opened standalone
  // never sends joinTable, and joinPlayer refuses a code it cannot find.
  registry.create(DEMO_CODE);

  const attached = new Set<SocketClient>();

  return {
    code: DEMO_CODE,

    attach(options) {
      const { socket, connection } = createLoopback(options);
      handleConnection(connection, registry);
      attached.add(socket);
      return socket;
    },

    adopt(connection) {
      handleConnection(connection, registry);
    },

    closeAll() {
      for (const socket of attached) socket.close();
      attached.clear();
    },
  };
}
