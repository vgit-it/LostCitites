import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerView, TableEvent, TableView } from '@shared/types';
import { createInMemoryRejoinStore } from './rejoinStore';
import { SessionStore, createSessionStore } from './session';
import { FakeSocket } from './testDoubles';

function stubTableView(overrides: Partial<TableView> = {}): TableView {
  return {
    viewer: 'table',
    round: 1,
    stage: 'playing',
    deckCount: 44,
    discardTops: { yellow: null, blue: null, white: null, green: null, red: null },
    turn: 0,
    phase: 'place',
    readyForNextRound: [false, false],
    players: [
      {
        seat: 0,
        name: 'Paul',
        connected: true,
        handCount: 8,
        expeditions: { yellow: [], blue: [], white: [], green: [], red: [] },
        roundScores: [],
        currentRoundScore: 0,
      },
      {
        seat: 1,
        name: 'Aditi',
        connected: true,
        handCount: 8,
        expeditions: { yellow: [], blue: [], white: [], green: [], red: [] },
        roundScores: [],
        currentRoundScore: 0,
      },
    ],
    ...overrides,
  };
}

let socket: FakeSocket;
let store: SessionStore;

beforeEach(() => {
  socket = new FakeSocket();
  store = createSessionStore(socket, createInMemoryRejoinStore());
});

describe('view handling', () => {
  it('starts with no view', () => {
    expect(store.getView()).toBeNull();
  });

  it('adopts the latest state frame and notifies subscribers', () => {
    const listener = vi.fn();
    store.subscribe(listener);

    socket.deliver({ t: 'state', view: stubTableView() });

    expect(store.getView()).not.toBeNull();
    expect(listener).toHaveBeenCalled();
  });

  it('replaces the view rather than merging it', () => {
    socket.deliver({ t: 'state', view: stubTableView({ deckCount: 44 }) });
    socket.deliver({ t: 'state', view: stubTableView({ deckCount: 12 }) });
    expect((store.getView() as TableView).deckCount).toBe(12);
  });
});

describe('events are cues, not state', () => {
  it('delivers cues to handlers without touching the view', () => {
    socket.deliver({ t: 'state', view: stubTableView({ deckCount: 44 }) });

    const seen: TableEvent[] = [];
    store.onTableEvent((event) => seen.push(event));
    socket.deliver({ t: 'event', kind: { name: 'roundOver' } });

    expect(seen).toEqual([{ name: 'roundOver' }]);
    // The view is exactly what the last state frame said.
    expect((store.getView() as TableView).deckCount).toBe(44);
    expect((store.getView() as TableView).stage).toBe('playing');
  });

  it('unsubscribes cue handlers', () => {
    const handler = vi.fn();
    const off = store.onTableEvent(handler);
    off();
    socket.deliver({ t: 'event', kind: { name: 'roundOver' } });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('errors', () => {
  it('exposes a server error and clears it on the next state', () => {
    socket.deliver({ t: 'error', message: 'Not your turn.' });
    expect(store.getError()).toBe('Not your turn.');

    socket.deliver({ t: 'state', view: stubTableView() });
    expect(store.getError()).toBeNull();
  });

  it('can be dismissed by the user', () => {
    socket.deliver({ t: 'error', message: 'Not your turn.' });
    store.dismissError();
    expect(store.getError()).toBeNull();
  });
});

describe('intents', () => {
  it('sends place, draw and ready without any rules logic', () => {
    store.place('blue-7', 'expedition');
    store.draw({ kind: 'discard', colour: 'red' });
    store.readyNextRound();

    expect(socket.sent).toEqual([
      { t: 'place', cardId: 'blue-7', target: 'expedition' },
      { t: 'draw', source: { kind: 'discard', colour: 'red' } },
      { t: 'readyNextRound' },
    ]);
  });
});

describe('joining and rejoining', () => {
  it('sends a join and remembers the code', () => {
    store.joinPlayer('314', 0, 'Paul');

    expect(socket.lastSent()).toEqual({
      t: 'joinPlayer',
      code: '314',
      seat: 0,
      name: 'Paul',
    });
    expect(store.getCode()).toBe('314');
  });

  it('re-sends the join automatically on reconnect', () => {
    store.joinPlayer('314', 1, 'Aditi');
    socket.clear();

    socket.reconnect();

    expect(socket.sent).toEqual([
      { t: 'joinPlayer', code: '314', seat: 1, name: 'Aditi' },
    ]);
  });

  it('auto-rejoins from stored membership without a join screen', () => {
    const stored = createInMemoryRejoinStore({
      code: '271',
      role: 'player',
      seat: 1,
      name: 'Aditi',
    });
    const freshSocket = new FakeSocket();
    const restored = createSessionStore(freshSocket, stored);

    expect(restored.getCode()).toBe('271');
    freshSocket.reconnect();
    expect(freshSocket.lastSent()).toEqual({
      t: 'joinPlayer',
      code: '271',
      seat: 1,
      name: 'Aditi',
    });
  });

  it('persists membership so a refresh skips the join screen', () => {
    const persistence = createInMemoryRejoinStore();
    const fresh = createSessionStore(new FakeSocket(), persistence);
    fresh.joinTable('555');

    expect(persistence.load()).toEqual({ code: '555', role: 'table' });
  });

  it('forgets membership on leave', () => {
    const persistence = createInMemoryRejoinStore();
    const fresh = createSessionStore(new FakeSocket(), persistence);
    fresh.joinPlayer('555', 0, 'Paul');
    fresh.leave();

    expect(persistence.load()).toBeNull();
    expect(fresh.getCode()).toBeNull();
    expect(fresh.getView()).toBeNull();
  });

  it('does not re-send a join when it never joined', () => {
    socket.reconnect();
    expect(socket.sent).toEqual([]);
  });
});

describe('connection status', () => {
  it('tracks the socket and notifies subscribers', () => {
    const listener = vi.fn();
    store.subscribe(listener);

    socket.setStatus('reconnecting');

    expect(store.getStatus()).toBe('reconnecting');
    expect(listener).toHaveBeenCalled();
  });

  it('keeps the last view while reconnecting, so the board stays readable', () => {
    socket.deliver({ t: 'state', view: stubTableView({ deckCount: 30 }) });
    socket.setStatus('reconnecting');

    expect((store.getView() as TableView).deckCount).toBe(30);
  });
});

describe('player view passthrough', () => {
  it('exposes precomputed legal moves untouched', () => {
    const playerView: PlayerView = {
      ...stubTableView(),
      viewer: 'player',
      seat: 0,
      hand: [{ id: 'blue-7', colour: 'blue', value: 7 }],
      legalPlacements: { 'blue-7': ['expedition', 'discard'] },
      legalDrawSources: [{ kind: 'deck' }],
      blockedDrawCardId: null,
    };
    socket.deliver({ t: 'state', view: playerView });

    expect(store.getView()).toEqual(playerView);
  });
});
