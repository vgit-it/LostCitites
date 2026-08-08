// ============================================================
// One interface, full screen.
//
// The whole point is that Table and Phone are mounted here exactly as
// main.tsx mounts them: same components, same SessionProvider, same
// session store. Only the socket underneath differs, and neither of them
// can tell — which is what makes this a demo of the real thing rather
// than a picture of it.
//
// Two ways in, and the route does not care which:
//
//   standalone  its own hub in this tab, a bot in the other seat. This is
//               what you open on an actual phone.
//   pane        an iframe inside the panes view, bridged to the parent's
//               hub over postMessage, so all three share one match.
// ============================================================

import { useEffect, useMemo } from 'react';
import { Seat } from '@shared/types';
import { createInMemoryRejoinStore, RejoinInfo } from '../session/rejoinStore';
import { createSessionStore, SessionStore } from '../session/session';
import { SessionProvider } from '../session/useSession';
import { SocketClient } from '../session/socket';
import { Phone } from '../phone/Phone';
import { Table } from '../table/Table';
import { createBridgeSocket } from './bridge';
import { DEMO_CODE, SEAT_NAMES } from './hub';
import { DemoParams } from './route';
import { DemoGame, findScenario, startScenario } from './scenarios';

/** Which seats a person is about to hold, given what they opened. */
function humanSeats(params: DemoParams): Seat[] {
  return params.view === 'play' ? [params.seat] : []; // the table only watches
}

/** Stable per role, and the address the parent bridge routes frames to. */
export function paneId(params: DemoParams): string {
  return params.view === 'table' ? 'table' : `seat${params.seat}`;
}

/** What this device is claiming, pre-seeded so the join screen is skipped. */
function membership(params: DemoParams, code: string): RejoinInfo {
  return params.view === 'table'
    ? { code, role: 'table' }
    : { code, role: 'player', seat: params.seat, name: SEAT_NAMES[params.seat] };
}

/**
 * True when this document is an iframe inside the panes view.
 *
 * Same-origin by construction — the parent sets the src — but reading
 * `window.parent.location` would still throw if that ever stopped being
 * true, so nothing here touches it.
 */
export function inPane(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

function Mounted({ params, session, code }: {
  params: DemoParams;
  session: SessionStore;
  code: string;
}) {
  return (
    <SessionProvider store={session}>
      {params.view === 'table' ? <Table code={code} /> : <Phone />}
    </SessionProvider>
  );
}

/** A pane: no game of its own, just a socket pointed at the parent's. */
function DemoPane({ params }: { params: DemoParams }) {
  const session = useMemo(() => {
    const socket = createBridgeSocket(
      window,
      window.parent,
      paneId(params),
      window.location.origin,
    );
    return createSessionStore(socket, createInMemoryRejoinStore(membership(params, DEMO_CODE)));
  }, [params.view, params.seat]);

  return <Mounted params={params} session={session} code={DEMO_CODE} />;
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

/** Standalone: this tab owns the game. */
function DemoStandalone({ params }: { params: DemoParams }) {
  const game = useDemoGame(params);

  // A store per mount, holding an in-memory membership. In-memory and not
  // localStorage on purpose: a demo must not overwrite the rejoin record of
  // a real game this browser is in the middle of. Pre-seeded, so the store
  // already believes it has a seat and re-sends the join on open — the same
  // path a reconnect takes, and why the demo phone never shows the join
  // screen.
  const session = useMemo(
    (): SessionStore =>
      createSessionStore(
        game.hub.attach() as SocketClient,
        createInMemoryRejoinStore(membership(params, game.hub.code)),
      ),
    [game, params.view, params.seat],
  );

  return <Mounted params={params} session={session} code={game.hub.code} />;
}

export function DemoRoute({ params }: { params: DemoParams }) {
  return inPane() ? <DemoPane params={params} /> : <DemoStandalone params={params} />;
}
