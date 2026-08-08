// Headless integration test for the whole protocol layer: three fake
// connections standing in for the tablet and both phones, driven through
// handleConnection with no real socket anywhere.
//
// This is where the BUILD_SPEC §15 "Protocol" checklist is asserted
// end to end, on the actual serialized frames.

import { beforeEach, describe, expect, it } from 'vitest';
import { PlayerView, TableView } from '@shared/types';
import { InMemoryRoomRegistry, RoomRegistry } from './registry';
import { mulberry32 } from './rng';
import { RoomBroadcaster } from './roomBroadcaster';
import { handleConnection } from './router';
import { FakeConnection } from './testDoubles';

const CODE = '123';

let registry: RoomRegistry;
let table: FakeConnection;
let phoneA: FakeConnection;
let phoneB: FakeConnection;

function connect(): FakeConnection {
  const connection = new FakeConnection();
  handleConnection(connection, registry);
  return connection;
}

/** Tablet claims the table, both phones take their seats, round is dealt. */
function seatEveryone(): void {
  table.emit({ t: 'joinTable', code: CODE });
  phoneA.emit({ t: 'joinPlayer', code: CODE, seat: 0, name: 'Paul' });
  phoneB.emit({ t: 'joinPlayer', code: CODE, seat: 1, name: 'Aditi' });
  phoneA.emit({ t: 'startRound' });
}

const tableView = () => table.latestView() as TableView;
const viewA = () => phoneA.latestView() as PlayerView;
const viewB = () => phoneB.latestView() as PlayerView;

beforeEach(() => {
  registry = new InMemoryRoomRegistry(() => new RoomBroadcaster(), mulberry32(7));
  table = connect();
  phoneA = connect();
  phoneB = connect();
});

describe('joining', () => {
  it('creates the room under the code the tablet supplies', () => {
    table.emit({ t: 'joinTable', code: CODE });
    expect(registry.get(CODE)).toBeDefined();
    expect(tableView().viewer).toBe('table');
  });

  it('rejects a phone joining a code that does not exist', () => {
    phoneA.emit({ t: 'joinPlayer', code: '999', seat: 0, name: 'Paul' });
    expect(phoneA.errors()).toContain('No game with code 999.');
  });

  it('reports both seats to the table as they connect', () => {
    seatEveryone();
    expect(tableView().players[0].connected).toBe(true);
    expect(tableView().players[1].connected).toBe(true);
    expect(tableView().players[0].name).toBe('Paul');
  });

  it('rejects intents sent before joining', () => {
    phoneA.emit({ t: 'draw', source: { kind: 'deck' } });
    expect(phoneA.errors()).toContain('Join a game first.');
  });

  it('answers malformed frames with an error instead of throwing', () => {
    expect(() => table.emit('not json at all')).not.toThrow();
    expect(table.errors()).toContain('Malformed message.');
  });
});

describe('view filtering on the wire', () => {
  beforeEach(seatEveryone);

  it('never sends a hand array to the table', () => {
    expect(table.sent.join('')).not.toContain('"hand"');
  });

  it('never sends deck contents to anyone', () => {
    for (const connection of [table, phoneA, phoneB]) {
      expect(connection.sent.join('')).not.toContain('"deck"');
    }
    expect(tableView().deckCount).toBe(44);
  });

  it('sends each phone only its own hand', () => {
    const handA = viewA().hand;
    const handB = viewB().hand;
    expect(handA).toHaveLength(8);
    expect(handB).toHaveLength(8);

    // No card of A's hand may appear anywhere in B's frames, or vice versa.
    for (const card of handA) expect(phoneB.sent.join('')).not.toContain(`"${card.id}"`);
    for (const card of handB) expect(phoneA.sent.join('')).not.toContain(`"${card.id}"`);
  });
});

describe('turn enforcement over the wire', () => {
  beforeEach(seatEveryone);

  it('rejects the table taking a turn', () => {
    table.emit({ t: 'draw', source: { kind: 'deck' } });
    expect(table.errors()).toContain('The table cannot take turns.');
  });

  it('rejects placing out of turn', () => {
    phoneB.emit({ t: 'place', cardId: viewB().hand[0].id, target: 'discard' });
    expect(phoneB.errors()).toContain('Not your turn.');
  });

  it('rejects drawing before placing', () => {
    phoneA.emit({ t: 'draw', source: { kind: 'deck' } });
    expect(phoneA.errors()).toContain('You must place a card first.');
  });

  it('omits the just-discarded card and empty piles from legalDrawSources', () => {
    const card = viewA().hand[0];
    phoneA.emit({ t: 'place', cardId: card.id, target: 'discard' });

    const sources = viewA().legalDrawSources;
    expect(sources).toContainEqual({ kind: 'deck' });
    expect(sources).not.toContainEqual({ kind: 'discard', colour: card.colour });
    expect(sources).toHaveLength(1); // every other pile is still empty
  });

  it('completes a turn and hands over to the other phone', () => {
    phoneA.emit({ t: 'place', cardId: viewA().hand[0].id, target: 'discard' });
    phoneA.emit({ t: 'draw', source: { kind: 'deck' } });

    expect(tableView().turn).toBe(1);
    expect(viewB().legalPlacements).not.toEqual({});
    expect(viewA().legalPlacements).toEqual({});
  });

  it('delivers animation cues to all three devices', () => {
    phoneA.emit({ t: 'place', cardId: viewA().hand[0].id, target: 'discard' });

    for (const connection of [table, phoneA, phoneB]) {
      const cues = connection.received().filter((m) => m.t === 'event');
      expect(cues.map((c) => (c as { kind: { name: string } }).kind.name)).toContain('placed');
    }
  });
});

describe('reconnection', () => {
  beforeEach(seatEveryone);

  it('resumes at the correct phase after a phone drops mid-turn', () => {
    phoneA.emit({ t: 'place', cardId: viewA().hand[0].id, target: 'discard' });
    phoneA.close();
    expect(tableView().players[0].connected).toBe(false);

    const reconnected = connect();
    reconnected.emit({ t: 'joinPlayer', code: CODE, seat: 0, name: 'Paul' });

    const resumed = reconnected.latestView() as PlayerView;
    expect(resumed.phase).toBe('draw');
    expect(resumed.turn).toBe(0);
    expect(resumed.hand).toHaveLength(7);
    expect(resumed.legalDrawSources.length).toBeGreaterThan(0);
  });

  it('does not mark the seat disconnected when the stale socket dies late', () => {
    const reconnected = connect();
    reconnected.emit({ t: 'joinPlayer', code: CODE, seat: 0, name: 'Paul' });

    // The old socket only now notices it is gone.
    phoneA.close();

    expect(tableView().players[0].connected).toBe(true);
    expect((reconnected.latestView() as PlayerView).hand).toHaveLength(8);
  });

  it('restores the full board when the table refreshes', () => {
    phoneA.emit({ t: 'place', cardId: viewA().hand[0].id, target: 'discard' });
    table.close();

    const refreshed = connect();
    refreshed.emit({ t: 'joinTable', code: CODE });

    const restored = refreshed.latestView() as TableView;
    expect(restored.stage).toBe('playing');
    expect(restored.deckCount).toBe(44);
    expect(restored.players[0].handCount).toBe(7);
  });
});

describe('round flow over the wire', () => {
  beforeEach(seatEveryone);

  it('gates the next deal on both readies', () => {
    const room = registry.get(CODE)!.room;
    room.snapshot().deck.length = 1;

    phoneA.emit({ t: 'place', cardId: viewA().hand[0].id, target: 'discard' });
    phoneA.emit({ t: 'draw', source: { kind: 'deck' } });
    expect(tableView().stage).toBe('roundEnd');

    phoneA.emit({ t: 'readyNextRound' });
    expect(tableView().stage).toBe('roundEnd');
    expect(tableView().readyForNextRound).toEqual([true, false]);

    phoneB.emit({ t: 'readyNextRound' });
    expect(tableView().stage).toBe('playing');
    expect(tableView().round).toBe(2);
  });
});
