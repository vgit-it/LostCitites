import { describe, expect, it } from 'vitest';
import { PlayerView, ServerMessage, Seat, TableView } from '@shared/types';
import { DEMO_CODE } from './hub';
import { SCENARIOS, findScenario, startScenario } from './scenarios';
import { DEFAULT_SCENARIO } from './route';

/** Joins the started game as the table and returns its latest view. */
function tableView(game: ReturnType<typeof startScenario>): TableView {
  const socket = game.hub.attach({ sync: true });
  let view: TableView | undefined;
  socket.onMessage((message: ServerMessage) => {
    if (message.t === 'state' && message.view.viewer === 'table') view = message.view;
  });
  socket.send({ t: 'joinTable', code: DEMO_CODE });
  if (!view) throw new Error('table never received a view');
  return view;
}

/** Takes a seat the scenario left open and returns that seat's view. */
function seatView(game: ReturnType<typeof startScenario>, seat: Seat): PlayerView {
  const socket = game.hub.attach({ sync: true });
  let view: PlayerView | undefined;
  socket.onMessage((message: ServerMessage) => {
    if (message.t === 'state' && message.view.viewer === 'player') view = message.view;
  });
  socket.send({ t: 'joinPlayer', code: DEMO_CODE, seat, name: 'Tester' });
  if (!view) throw new Error('seat never received a view');
  return view;
}

const start = (id: string, seed = 1234, humanSeats: Seat[] = [0]) =>
  startScenario({ scenario: findScenario(id), seed, humanSeats });

describe('scenario lookup', () => {
  it('falls back to the default for an unknown or missing id', () => {
    expect(findScenario('nonsense').id).toBe(DEFAULT_SCENARIO);
    expect(findScenario(null).id).toBe(DEFAULT_SCENARIO);
  });

  it('resolves each listed scenario by id', () => {
    for (const scenario of SCENARIOS) {
      expect(findScenario(scenario.id).id).toBe(scenario.id);
    }
  });
});

describe('starting a scenario', () => {
  it('leaves the lobby undealt', () => {
    const view = tableView(start('lobby'));

    expect(view.stage).toBe('lobby');
    expect(view.players[0].handCount).toBe(0);
  });

  it('deals a fresh hand', () => {
    const view = seatView(start('fresh'), 0);

    expect(view.stage).toBe('playing');
    expect(view.hand).toHaveLength(8);
    expect(view.turn).toBe(0);
    expect(view.phase).toBe('place');
  });

  it('stops mid-turn, on the 7-card fan', () => {
    const view = seatView(start('midturn'), 0);

    expect(view.phase).toBe('draw');
    expect(view.hand).toHaveLength(7);
    expect(view.legalDrawSources.length).toBeGreaterThan(0);
  });

  it('stops with a discard pile shut', () => {
    const view = seatView(start('blocked'), 0);

    expect(view.phase).toBe('draw');
    expect(view.blockedDrawCardId).not.toBeNull();
  });

  it('reaches a mid-round position with columns and discards in play', () => {
    const game = start('midround');
    const view = seatView(game, 0);

    expect(view.stage).toBe('playing');
    expect(view.phase).toBe('place');
    expect(game.steps).toBeGreaterThanOrEqual(24);

    const played = view.players.flatMap((player) =>
      Object.values(player.expeditions).flat(),
    );
    const discarded = Object.values(view.discardTops).filter(Boolean);
    expect(played.length + discarded.length).toBeGreaterThan(0);
    expect(view.deckCount).toBeLessThan(44);
  });

  it('reaches a nearly empty deck', () => {
    const view = seatView(start('lateround'), 0);

    expect(view.deckCount).toBeLessThanOrEqual(4);
    expect(view.stage).toBe('playing');
  });

  it('reaches a scored round with the gate still up', () => {
    const view = tableView(start('roundend'));

    expect(view.stage).toBe('roundEnd');
    expect(view.players[0].roundScores).toHaveLength(1);
    // Stopped before the bots readied, or the round would have advanced.
    expect(view.readyForNextRound).toEqual([false, false]);
  });

  it('reaches the end of a match', () => {
    const view = tableView(start('matchend'));

    expect(view.stage).toBe('matchEnd');
    expect(view.round).toBe(3);
    expect(view.players[0].roundScores).toHaveLength(3);
  });

  it('actually reaches every scenario, from a spread of seeds', () => {
    // Asserting `reached`, not merely that nothing threw: a predicate that
    // the bots overshoot would leave the tester on the wrong screen with no
    // indication anything had gone wrong.
    for (const scenario of SCENARIOS) {
      for (const seed of [1, 99, 12345, 65536, 20260808]) {
        expect(start(scenario.id, seed).reached, `${scenario.id} @ ${seed}`).toBe(true);
      }
    }
  });

  it('is reproducible: same scenario and seed, same position', () => {
    const once = seatView(start('midround', 555), 0);
    const twice = seatView(start('midround', 555), 0);

    expect(JSON.stringify(once)).toEqual(JSON.stringify(twice));
  });

  it('differs across seeds', () => {
    const a = seatView(start('midround', 555), 0);
    const b = seatView(start('midround', 556), 0);

    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });

  it('keeps a bot on any seat no person is taking', () => {
    expect(start('midround', 1, [0]).bots.map((bot) => bot.seat)).toEqual([1]);
    expect(start('midround', 1, [0, 1]).bots).toEqual([]);
  });

  it('still hides the opponent hand once a person takes a seat mid-game', () => {
    const game = start('midround', 4242, [0, 1]);
    const view0 = seatView(game, 0);
    const view1 = seatView(game, 1);

    const wire0 = JSON.stringify(view0);
    for (const card of view1.hand) expect(wire0).not.toContain(card.id);
    expect(wire0).not.toContain('"deck"');
  });
});
