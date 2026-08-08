// The bot is a client, so these tests are integration tests of the whole
// stack: registry, router, room, rules, views and the transport, driven
// through nothing but the wire protocol.
//
// scripts/headlessGame.test.ts already plays full matches, but it calls the
// rules layer directly. Nothing before this played one through the protocol.

import { describe, expect, it, vi } from 'vitest';
import { COLOURS, PlayerView, Seat, ServerMessage, TableView } from '@shared/types';
import { mulberry32 } from '../../../server/rng';
import { createBot, pump } from './bot';
import { createHub, DEMO_CODE } from './hub';

/** Drains the microtask queue, which is where async loopback delivery lands. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A hub with the table bound and a bot in each seat, dealt and ready to play. */
function seatedMatch(seed: number) {
  const hub = createHub(seed);
  const table = hub.attach({ sync: true });

  const tableViews: TableView[] = [];
  table.onMessage((message: ServerMessage) => {
    if (message.t === 'state' && message.view.viewer === 'table') tableViews.push(message.view);
  });
  table.send({ t: 'joinTable', code: DEMO_CODE });

  // Every frame each seat was sent. A second listener on the bot's own
  // socket, rather than a spectator connection — joining a seat *replaces*
  // whoever holds it, so a spy would silently unbind the bot it watches.
  const seatViews: PlayerView[] = [];
  const bots = [0, 1].map((seat) => {
    const socket = hub.attach({ sync: true });
    socket.onMessage((message: ServerMessage) => {
      if (message.t === 'state' && message.view.viewer === 'player') seatViews.push(message.view);
    });
    return createBot(socket, seat as Seat, mulberry32(seed + seat + 1));
  });

  table.send({ t: 'startRound' });

  const latest = (): TableView => tableViews[tableViews.length - 1];
  return { hub, bots, latest, seatViews };
}

describe('the bot', () => {
  it('joins its seat and receives its own hand', () => {
    const hub = createHub(3);
    const table = hub.attach({ sync: true });
    table.send({ t: 'joinTable', code: DEMO_CODE });

    const bot = createBot(hub.attach({ sync: true }), 0, mulberry32(1));
    createBot(hub.attach({ sync: true }), 1, mulberry32(2));
    table.send({ t: 'startRound' });

    expect(bot.seat).toBe(0);
    expect(bot.view()?.hand).toHaveLength(8);
  });

  it('plays a half-turn at a time, so a scenario can stop mid-turn', () => {
    const { bots, latest } = seatedMatch(11);
    const onTurn = bots[latest().turn];

    expect(latest().phase).toBe('place');
    expect(onTurn.step()).toBe(true);
    expect(latest().phase).toBe('draw');

    expect(onTurn.step()).toBe(true);
    expect(latest().phase).toBe('place');
  });

  it('does not act when it is not its turn', () => {
    const { bots, latest } = seatedMatch(11);
    const waiting = bots[latest().turn === 0 ? 1 : 0];

    expect(waiting.step()).toBe(false);
  });

  it('acts once per position, so an unanswered move cannot double-send', async () => {
    // Async delivery, which is what the live browser bot runs on: the
    // server's answer has not landed between these two calls, so the view
    // still says "your move, place". Without the guard the bot would send a
    // second placement for a card it has already committed.
    const hub = createHub(11);
    const table = hub.attach({ sync: true });
    table.send({ t: 'joinTable', code: DEMO_CODE });

    const sent: unknown[] = [];
    const socket = hub.attach();
    const send = socket.send.bind(socket);
    socket.send = (message) => {
      sent.push(message);
      send(message);
    };
    const bot = createBot(socket, 0, mulberry32(1));
    createBot(hub.attach({ sync: true }), 1, mulberry32(2));

    // Seat 0's join is queued, not immediate. Dealing before it lands would
    // be refused for a seat that has not joined.
    await flush();
    table.send({ t: 'startRound' });
    await flush();

    expect(bot.view()?.turn).toBe(0); // dealRound always starts seat 0
    sent.length = 0;

    expect(bot.step()).toBe(true);
    expect(bot.step()).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('plays a whole 3-round match through the protocol', () => {
    const { bots, latest } = seatedMatch(2024);

    const finished = pump(bots, () => latest().stage === 'matchEnd');

    expect(finished).toBe(true);
    const view = latest();
    expect(view.stage).toBe('matchEnd');
    expect(view.round).toBe(3);
    expect(view.players[0].roundScores).toHaveLength(3);
    expect(view.players[1].roundScores).toHaveLength(3);
  });

  it('finishes a match from any of a spread of seeds', () => {
    for (const seed of [1, 7, 99, 12345, 65536]) {
      const { bots, latest } = seatedMatch(seed);
      expect(pump(bots, () => latest().stage === 'matchEnd')).toBe(true);
    }
  });

  it('is never offered the card it just discarded, across a whole match', () => {
    const { bots, latest, seatViews } = seatedMatch(808);

    pump(bots, () => latest().stage === 'matchEnd');

    const blocked = seatViews.filter(
      (view) => view.blockedDrawCardId !== null && view.legalDrawSources.length > 0,
    );
    expect(blocked.length).toBeGreaterThan(0);

    for (const view of blocked) {
      // Only that one pile is shut, not discards in general — the blocked
      // card is by definition the top of its own colour.
      const shut = COLOURS.find((c) => view.discardTops[c]?.id === view.blockedDrawCardId);
      expect(shut).toBeDefined();
      expect(view.legalDrawSources).not.toContainEqual({ kind: 'discard', colour: shut });
    }
  });

  it('self-drives on a timer when it is being watched', () => {
    vi.useFakeTimers();
    try {
      const { bots, latest } = seatedMatch(5);
      const before = latest().phase;

      bots[latest().turn].start(700);
      expect(latest().phase).toBe(before);

      vi.advanceTimersByTime(700);
      expect(latest().phase).not.toBe(before);

      for (const bot of bots) bot.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
