// The room state machine, driven entirely through a recording fake.
// Covers the turn-order half of the BUILD_SPEC §15 "Protocol" checklist
// plus the round/match transitions the rules layer leaves unannounced.

import { beforeEach, describe, expect, it } from 'vitest';
import { GameState, PlayerView, Seat } from '@shared/types';
import { mulberry32 } from './rng';
import { Room } from './room';
import { FakeChannel } from './testDoubles';

let channel: FakeChannel;

function newRoom(): Room {
  channel = new FakeChannel();
  return new Room('123', { broadcaster: channel, rng: mulberry32(5) });
}

/** A room with both seats joined and the first round dealt. */
function startedRoom(): Room {
  const room = newRoom();
  room.bindPlayer(0, 'Paul');
  room.bindPlayer(1, 'Aditi');
  room.startRound();
  channel.clearSignals();
  return room;
}

function view(seat: Seat): PlayerView {
  return channel.latest(seat === 0 ? 'seat0' : 'seat1') as PlayerView;
}

/** Plays a legal place-then-draw turn for whoever is on turn. */
function playTurn(room: Room): void {
  const seat = room.snapshot().turn;
  const [cardId, targets] = Object.entries(view(seat).legalPlacements)[0];
  room.place(seat, cardId, targets[0]);
  room.draw(seat, { kind: 'deck' });
}

beforeEach(() => {
  channel = new FakeChannel();
});

describe('lobby', () => {
  it('refuses to deal until both seats are connected', () => {
    const room = newRoom();
    room.bindPlayer(0, 'Paul');
    room.startRound();

    expect(room.snapshot().stage).toBe('lobby');
    expect(channel.errors.map((e) => e.message)).toContain(
      'Both players must join before dealing.',
    );
  });

  it('deals once both seats are connected', () => {
    const room = startedRoom();
    expect(room.snapshot().stage).toBe('playing');
    expect(room.snapshot().deck).toHaveLength(44);
  });

  it('refuses to deal twice', () => {
    const room = startedRoom();
    room.startRound();
    expect(channel.errors.map((e) => e.message)).toContain('The game has already started.');
  });

  it('broadcasts to all three roles on every change', () => {
    const room = newRoom();
    room.bindPlayer(0, 'Paul');

    expect(channel.states.map((s) => s.role)).toEqual(['table', 'seat0', 'seat1']);
    expect(room.snapshot().players[0].name).toBe('Paul');
  });
});

describe('turn enforcement', () => {
  it('rejects placing out of turn', () => {
    const room = startedRoom();
    const offTurn = view(1);
    room.place(1, offTurn.hand[0].id, 'discard');

    expect(channel.errors).toEqual([{ role: 'seat1', message: 'Not your turn.' }]);
    expect(room.snapshot().phase).toBe('place');
  });

  it('rejects drawing before placing', () => {
    const room = startedRoom();
    room.draw(0, { kind: 'deck' });

    expect(channel.errors).toEqual([
      { role: 'seat0', message: 'You must place a card first.' },
    ]);
  });

  it('rejects placing twice in one turn', () => {
    const room = startedRoom();
    const hand = view(0).hand;
    room.place(0, hand[0].id, 'discard');
    room.place(0, hand[1].id, 'discard');

    expect(channel.errors).toEqual([
      { role: 'seat0', message: 'You have already placed; draw a card.' },
    ]);
  });

  it('sends the error only to the offending seat', () => {
    const room = startedRoom();
    room.draw(0, { kind: 'deck' });
    expect(channel.errors.every((e) => e.role === 'seat0')).toBe(true);
  });

  it('keeps the just-discarded card out of the next draw sources', () => {
    const room = startedRoom();
    const card = view(0).hand[0];
    room.place(0, card.id, 'discard');

    expect(view(0).legalDrawSources).not.toContainEqual({
      kind: 'discard',
      colour: card.colour,
    });
    room.draw(0, { kind: 'discard', colour: card.colour });
    expect(channel.errors.map((e) => e.message)).toContain(
      'You cannot take back the card you just discarded.',
    );
  });

  it('passes the turn after a completed place-then-draw', () => {
    const room = startedRoom();
    room.place(0, view(0).hand[0].id, 'discard');
    room.draw(0, { kind: 'deck' });

    expect(room.snapshot().turn).toBe(1);
    expect(room.snapshot().phase).toBe('place');
  });
});

describe('animation cues', () => {
  it('emits placed and drew to all three roles', () => {
    const room = startedRoom();
    const card = view(0).hand[0];

    room.place(0, card.id, 'discard');
    const placed = channel.events.filter((e) => e.event.name === 'placed');
    expect(placed.map((e) => e.role)).toEqual(['table', 'seat0', 'seat1']);

    room.draw(0, { kind: 'deck' });
    expect(channel.events.filter((e) => e.event.name === 'drew')).toHaveLength(3);
  });

  it('emits nothing when the intent was rejected', () => {
    const room = startedRoom();
    room.place(1, view(1).hand[0].id, 'discard');
    expect(channel.events).toHaveLength(0);
  });
});

describe('round and match transitions', () => {
  it('announces roundOver when the last card is drawn', () => {
    const room = startedRoom();
    room.snapshot().deck.length = 1;

    room.place(0, view(0).hand[0].id, 'discard');
    room.draw(0, { kind: 'deck' });

    expect(room.snapshot().stage).toBe('roundEnd');
    expect(channel.events.filter((e) => e.event.name === 'roundOver')).toHaveLength(3);
  });

  it('requires both readies before dealing the next round', () => {
    const room = startedRoom();
    room.snapshot().deck.length = 1;
    room.place(0, view(0).hand[0].id, 'discard');
    room.draw(0, { kind: 'deck' });

    room.readyNextRound(0);
    expect(room.snapshot().stage).toBe('roundEnd');
    expect(room.snapshot().round).toBe(1);

    room.readyNextRound(1);
    expect(room.snapshot().stage).toBe('playing');
    expect(room.snapshot().round).toBe(2);
  });

  it('rejects a ready while the round is still running', () => {
    const room = startedRoom();
    room.readyNextRound(0);
    expect(channel.errors.map((e) => e.message)).toContain('The round is still in progress.');
  });

  it('announces matchOver after round 3 and never advances past it', () => {
    const room = startedRoom();
    // Jumping straight to the last round; snapshot() is readonly by design.
    const state = room.snapshot() as GameState;
    state.round = 3;
    state.deck.length = 1;

    room.place(0, view(0).hand[0].id, 'discard');
    room.draw(0, { kind: 'deck' });

    expect(state.stage).toBe('matchEnd');
    expect(channel.events.filter((e) => e.event.name === 'matchOver')).toHaveLength(3);

    // A stray ready at matchEnd must not roll the round over to 4.
    room.readyNextRound(0);
    room.readyNextRound(1);
    expect(state.round).toBe(3);
    expect(state.stage).toBe('matchEnd');
  });

  it('plays a full round through the room without stalling', () => {
    const room = startedRoom();
    room.bindTable();

    let guard = 0;
    while (room.snapshot().stage === 'playing') {
      if (++guard > 200) throw new Error('round did not terminate');
      playTurn(room);
    }

    expect(room.snapshot().stage).toBe('roundEnd');
    expect(room.snapshot().players[0].roundScores).toHaveLength(1);
    expect(channel.errors).toEqual([]);
  });
});

describe('disconnection', () => {
  it('marks the seat disconnected without destroying the room', () => {
    const room = startedRoom();
    room.unbind('seat0');

    expect(room.snapshot().players[0].connected).toBe(false);
    expect(room.snapshot().stage).toBe('playing');
  });

  it('leaves turn and phase untouched across a disconnect mid-turn', () => {
    const room = startedRoom();
    room.place(0, view(0).hand[0].id, 'discard');

    room.unbind('seat0');
    room.bindPlayer(0, 'Paul');

    expect(room.snapshot().turn).toBe(0);
    expect(room.snapshot().phase).toBe('draw');
    expect(room.snapshot().players[0].connected).toBe(true);
  });

  it('keeps the seat name when a reconnect sends an empty one', () => {
    const room = startedRoom();
    room.bindPlayer(0, '');
    expect(room.snapshot().players[0].name).toBe('Paul');
  });
});
