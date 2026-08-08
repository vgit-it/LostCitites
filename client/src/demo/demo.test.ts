// Tests for the in-browser server and its transport.
//
// These deliberately re-assert the view-filtering guarantee that
// server/views.test.ts already covers. That test checks the pure function;
// this one checks what a client actually receives after the whole
// registry -> router -> room -> broadcaster -> transport path has run, which
// is the only thing a deployed demo can leak through.

import { describe, expect, it } from 'vitest';
import { Card, ClientView, PlayerView, ServerMessage, TableView } from '@shared/types';
import { createHub, DEMO_CODE } from './hub';
import { createLoopback } from './loopback';
import { SocketClient } from '../session/socket';

/** Drains the microtask queue, which is where async loopback delivery lands. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Records everything a socket receives, the way a session store would. */
function record(socket: SocketClient): ServerMessage[] {
  const received: ServerMessage[] = [];
  socket.onMessage((message) => received.push(message));
  return received;
}

function latestView(received: ServerMessage[]): ClientView | undefined {
  for (let i = received.length - 1; i >= 0; i--) {
    const message = received[i];
    if (message.t === 'state') return message.view;
  }
  return undefined;
}

describe('loopback transport', () => {
  it('carries a client message to the server side as a raw string', async () => {
    const { socket, connection } = createLoopback();
    const raw: string[] = [];
    connection.onMessage((message) => raw.push(message));

    socket.send({ t: 'startRound' });
    await flush();

    expect(raw).toEqual(['{"t":"startRound"}']);
  });

  it('carries a server frame back as a parsed message', async () => {
    const { socket, connection } = createLoopback();
    const received = record(socket);

    connection.send(JSON.stringify({ t: 'error', message: 'nope' }));
    await flush();

    expect(received).toEqual([{ t: 'error', message: 'nope' }]);
  });

  it('does not deliver inside the caller stack by default', () => {
    const { socket, connection } = createLoopback();
    const raw: string[] = [];
    connection.onMessage((message) => raw.push(message));

    socket.send({ t: 'startRound' });

    // The whole point of the default: a real socket never lands a reply
    // before send() returns, so neither does this one.
    expect(raw).toEqual([]);
  });

  it('delivers in-stack when sync is asked for', () => {
    const { socket, connection } = createLoopback({ sync: true });
    const raw: string[] = [];
    connection.onMessage((message) => raw.push(message));

    socket.send({ t: 'startRound' });

    expect(raw).toEqual(['{"t":"startRound"}']);
  });

  it('fires open on a microtask so a session store can register first', async () => {
    const { socket } = createLoopback();
    let opened = false;
    socket.onOpen(() => {
      opened = true;
    });

    expect(opened).toBe(false);
    await flush();
    expect(opened).toBe(true);
  });

  it('closing tells the server side and stops delivery', async () => {
    const { socket, connection } = createLoopback();
    let closed = false;
    connection.onClose(() => {
      closed = true;
    });
    const raw: string[] = [];
    connection.onMessage((message) => raw.push(message));

    socket.close();
    await flush();
    expect(closed).toBe(true);
    expect(socket.getStatus()).toBe('closed');

    socket.send({ t: 'startRound' });
    await flush();
    expect(raw).toEqual([]);
  });
});

describe('the in-browser hub', () => {
  it('serves a table view to a device that claims the table', async () => {
    const hub = createHub(1);
    const table = hub.attach({ sync: true });
    const received = record(table);

    table.send({ t: 'joinTable', code: DEMO_CODE });

    const view = latestView(received);
    expect(view?.viewer).toBe('table');
    expect((view as TableView).stage).toBe('lobby');
  });

  it('has the room already, so a phone can join without a table present', () => {
    const hub = createHub(1);
    const phone = hub.attach({ sync: true });
    const received = record(phone);

    phone.send({ t: 'joinPlayer', code: DEMO_CODE, seat: 0, name: 'Ada' });

    expect(received.some((m) => m.t === 'error')).toBe(false);
    expect(latestView(received)?.viewer).toBe('player');
  });

  it('deals once both seats are in, and gives each role its own view', () => {
    const hub = createHub(42);
    const table = hub.attach({ sync: true });
    const seat0 = hub.attach({ sync: true });
    const seat1 = hub.attach({ sync: true });
    const [tableSeen, seat0Seen, seat1Seen] = [record(table), record(seat0), record(seat1)];

    table.send({ t: 'joinTable', code: DEMO_CODE });
    seat0.send({ t: 'joinPlayer', code: DEMO_CODE, seat: 0, name: 'Ada' });
    seat1.send({ t: 'joinPlayer', code: DEMO_CODE, seat: 1, name: 'Bob' });
    seat0.send({ t: 'startRound' });

    const tableView = latestView(tableSeen) as TableView;
    const view0 = latestView(seat0Seen) as PlayerView;
    const view1 = latestView(seat1Seen) as PlayerView;

    expect(tableView.stage).toBe('playing');
    expect(view0.hand).toHaveLength(8);
    expect(view1.hand).toHaveLength(8);
    expect(view0.seat).toBe(0);
    expect(view1.seat).toBe(1);
    // The table is told counts, never cards.
    expect(tableView.players[0].handCount).toBe(8);
    expect(tableView).not.toHaveProperty('hand');
  });

  it('is deterministic for a seed, and different across seeds', () => {
    const deal = (seed: number): Card[] => {
      const hub = createHub(seed);
      const table = hub.attach({ sync: true });
      const seat0 = hub.attach({ sync: true });
      const seat1 = hub.attach({ sync: true });
      const seen = record(seat0);

      table.send({ t: 'joinTable', code: DEMO_CODE });
      seat0.send({ t: 'joinPlayer', code: DEMO_CODE, seat: 0, name: 'Ada' });
      seat1.send({ t: 'joinPlayer', code: DEMO_CODE, seat: 1, name: 'Bob' });
      seat0.send({ t: 'startRound' });

      return (latestView(seen) as PlayerView).hand;
    };

    expect(deal(42)).toEqual(deal(42));
    expect(deal(42)).not.toEqual(deal(43));
  });

  it('never leaks the opponent hand or the deck into a seat view', () => {
    const hub = createHub(7);
    const table = hub.attach({ sync: true });
    const seat0 = hub.attach({ sync: true });
    const seat1 = hub.attach({ sync: true });
    const [seat0Seen, seat1Seen] = [record(seat0), record(seat1)];

    table.send({ t: 'joinTable', code: DEMO_CODE });
    seat0.send({ t: 'joinPlayer', code: DEMO_CODE, seat: 0, name: 'Ada' });
    seat1.send({ t: 'joinPlayer', code: DEMO_CODE, seat: 1, name: 'Bob' });
    seat0.send({ t: 'startRound' });

    const view0 = latestView(seat0Seen) as PlayerView;
    const view1 = latestView(seat1Seen) as PlayerView;

    // Read against the wire form, not the object: this is what a browser
    // devtools network pane would show someone holding the other phone.
    const wire0 = JSON.stringify(view0);
    for (const card of view1.hand) {
      expect(wire0).not.toContain(card.id);
    }

    // 60 cards, 16 of them dealt. Nothing in seat 0's frame may account for
    // a card that is neither its own nor visible on the table.
    const visible = new Set(view0.hand.map((c) => c.id));
    const ids = [...wire0.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(visible.has(id)).toBe(true);
  });

  it('closeAll drops every attached socket', async () => {
    const hub = createHub(1);
    const a = hub.attach();
    const b = hub.attach();

    hub.closeAll();
    await flush();

    expect(a.getStatus()).toBe('closed');
    expect(b.getStatus()).toBe('closed');
  });
});
