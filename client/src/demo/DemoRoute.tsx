// ============================================================
// One interface, full screen, against a game that is already in position.
//
// The whole point is that Table and Phone are mounted here exactly as
// main.tsx mounts them: same components, same SessionProvider, same
// session store. Only the socket underneath differs, and neither of them
// can tell — which is what makes this a demo of the real thing rather
// than a picture of it.
// ============================================================

import { useEffect, useMemo } from 'react';
import { Seat } from '@shared/types';
import { createInMemoryRejoinStore } from '../session/rejoinStore';
import { createSessionStore } from '../session/session';
import { SessionProvider } from '../session/useSession';
import { Phone } from '../phone/Phone';
import { Table } from '../table/Table';
import { DemoParams } from './route';
import { DemoGame, findScenario, startScenario } from './scenarios';

/** Which seats a person is about to hold, given what they opened. */
function humanSeats(params: DemoParams): Seat[] {
  if (params.view === 'play') return [params.seat];
  return []; // the table only ever watches
}

export function useDemoGame(params: DemoParams): DemoGame {
  // Keyed on the things that define the position. A change to any of them
  // means a different game, and the caller reloads rather than trying to
  // migrate one hub into another.
  const game = useMemo(
    () =>
      startScenario({
        scenario: findScenario(params.scenario),
        seed: params.seed,
        humanSeats: humanSeats(params),
      }),
    [params.scenario, params.seed, params.view, params.seat],
  );

  useEffect(() => {
    if (!params.bot) return;
    for (const bot of game.bots) bot.start();
    return () => {
      for (const bot of game.bots) bot.stop();
    };
  }, [game, params.bot]);

  return game;
}

export function DemoRoute({ params }: { params: DemoParams }) {
  const game = useDemoGame(params);

  // A store per mount, holding an in-memory membership. In-memory and not
  // localStorage on purpose: a demo must not overwrite the rejoin record of
  // a real game this browser is in the middle of.
  const session = useMemo(() => {
    const rejoin =
      params.view === 'table'
        ? createInMemoryRejoinStore({ code: game.hub.code, role: 'table' as const })
        : createInMemoryRejoinStore({
            code: game.hub.code,
            role: 'player' as const,
            seat: params.seat,
            name: 'You',
          });
    // Pre-seeded, so the session store already believes it has a seat and
    // re-sends the join on open. That is the same path a reconnect takes,
    // and it is why the demo phone never shows the join screen.
    return createSessionStore(game.hub.attach(), rejoin);
  }, [game, params.view, params.seat]);

  return (
    <SessionProvider store={session}>
      {params.view === 'table' ? <Table code={game.hub.code} /> : <Phone />}
    </SessionProvider>
  );
}
