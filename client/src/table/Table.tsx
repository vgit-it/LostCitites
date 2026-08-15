// The shared table display. Landscape, read to from ~1 metre.
//
// Very nearly input-free, and for the original reason: nothing here responds
// to a tap, so leaning on the tablet cannot change the game. The single
// exception is the reach for a card during a draw phase — see
// drawGesture.ts, which explains why a directional pull is safe where a tap
// would not have been.

import { useEffect, useRef, useState } from 'react';
import { COLOURS, Card as CardModel, DrawSource, Seat, TableView } from '@shared/types';
import {
  useClientView,
  useConnectionStatus,
  useSession,
  useTableEvents,
} from '../session/useSession';
import { FLIGHT_MS } from '../platform/motion';
import { useWakeLock } from '../platform/wakeLock';
import { CardFlight, Rect } from '../shared/CardFlight';
import { edgeRect } from '../shared/flightPath';
import { Column } from './Column';
import { ColumnMetrics, sideMetrics } from './columnMetrics';
import { DiscardRow } from './DiscardRow';
import { FlightPlan, planFlight } from './flights';
import { JoinCode } from './JoinCode';
import { MatchEnd, RoundEnd } from './RoundEnd';

/** A seat's join link, for the lobby QR. What `main.tsx` builds from the code. */
export interface SeatInvite {
  seat: Seat;
  url: string;
}

/**
 * The two numbers the CSS needs to size a side's cards, as custom properties.
 *
 * Fractions rather than lengths: the side's own height arrives in the CSS as
 * 100cqh, so nothing here has to know a pixel.
 */
function sideStyle(metrics: ColumnMetrics): React.CSSProperties {
  return {
    '--card-frac': metrics.cardFraction.toFixed(4),
    '--show': metrics.show.toFixed(4),
  } as React.CSSProperties;
}

/**
 * A live element's rect, or null when there is nothing to measure. The
 * zero-width guard is also why flights simply do not happen under test:
 * jsdom implements no layout, so every rect comes back zeroed.
 */
function rectOf(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
}

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}

interface Flight {
  card: CardModel | null;
  from: Rect;
  to: Rect;
  kind: 'land' | 'throw';
}

export function Table({ code, invites }: { code: string; invites?: SeatInvite[] }) {
  const session = useSession();
  const view = useClientView();
  const status = useConnectionStatus();
  useWakeLock();

  const [flight, setFlight] = useState<Flight | null>(null);
  /** The card being flown in, held back until it lands. */
  const [arrivingId, setArrivingId] = useState<string | null>(null);

  /**
   * The view as it stood before the cue that just arrived.
   *
   * The server emits its cue and then broadcasts, so an event handler still
   * sees the previous view — which is where a card just taken off a discard
   * pile still exists. Updated at the end of the effect below, after the plan
   * has read it.
   */
  const before = useRef<TableView | null>(null);
  const pending = useRef<FlightPlan | null>(null);

  // Cosmetic only. The next `state` is still the source of truth for
  // everything on screen; this decides nothing.
  useTableEvents((event) => {
    if (!before.current) return;
    const plan = planFlight(event, before.current);
    if (plan) pending.current = plan;
  });

  // Measured here rather than in the handler: an arriving card is not on the
  // table until the state that came with the cue has rendered.
  useEffect(() => {
    const table = view?.viewer === 'table' ? view : null;
    const plan = pending.current;
    pending.current = null;
    before.current = table;

    if (!plan || !table) return;
    const rect = rectOf(plan.anchor);
    if (!rect) return;

    const off = edgeRect(rect, plan.edge, viewport());
    setFlight(
      plan.direction === 'in'
        ? { card: plan.card, from: off, to: rect, kind: 'land' }
        : { card: plan.card, from: rect, to: off, kind: 'throw' },
    );
    setArrivingId(plan.hideCardId);
  }, [view]);

  // A held-back card must reappear even if its flight never reports finishing
  // — a round ending mid-flight unmounts the overlay, and its promise then
  // resolves into nothing. A missed animation is a blink; a card left
  // invisible on the shared display is the game lying about its own state.
  useEffect(() => {
    if (!arrivingId) return;
    const timer = setTimeout(() => setArrivingId(null), FLIGHT_MS * 2);
    return () => clearTimeout(timer);
  }, [arrivingId]);

  // The table claims its room once, and re-claims automatically on reconnect.
  useEffect(() => {
    if (session.getCode() !== code) session.joinTable(code);
  }, [session, code]);

  if (!view || view.viewer !== 'table') {
    return <Waiting code={code} status={status} invites={invites} />;
  }

  return (
    <div className="table">
      {status !== 'open' && <div className="reconnect-bar label">Reconnecting…</div>}
      {view.stage === 'lobby' && <Lobby view={view} code={code} invites={invites} />}
      {view.stage === 'playing' && (
        <Board
          view={view}
          arrivingId={arrivingId}
          onDraw={(source) => session.draw(source)}
        />
      )}
      {view.stage === 'roundEnd' && (
        <RoundEnd round={view.round} players={view.players} ready={view.readyForNextRound} />
      )}
      {view.stage === 'matchEnd' && <MatchEnd players={view.players} />}

      {flight && (
        <CardFlight
          key={`${flight.card?.id ?? 'deck'}-${flight.kind}-${arrivingId ?? ''}`}
          card={flight.card}
          from={flight.from}
          to={flight.to}
          kind={flight.kind}
          onDone={() => {
            setFlight(null);
            setArrivingId(null);
          }}
        />
      )}
    </div>
  );
}

/** An empty seat slot: its QR if one was given, else the plain waiting dot. */
export function SeatSlot({
  seat,
  name,
  invites,
}: {
  seat: Seat;
  name?: string;
  invites?: SeatInvite[];
}) {
  if (name) {
    return (
      <>
        <span className="lobby__dot" aria-hidden="true" />
        {name}
      </>
    );
  }
  const invite = invites?.find((i) => i.seat === seat);
  if (invite) return <JoinCode url={invite.url} label={`Scan to join as seat ${seat + 1}`} />;
  return (
    <>
      <span className="lobby__dot" aria-hidden="true" />
      {`Seat ${seat + 1} — waiting`}
    </>
  );
}

function Waiting({
  code,
  status,
  invites,
}: {
  code: string;
  status: string;
  invites?: SeatInvite[];
}) {
  return (
    <div className="screen screen--lobby">
      <p className="label">Room code</p>
      <p className="lobby__code">{code}</p>
      {invites && (
        <ul className="lobby__seats">
          {invites.map((invite) => (
            <li key={invite.seat} className="has-code">
              <SeatSlot seat={invite.seat} invites={invites} />
            </li>
          ))}
        </ul>
      )}
      <p className="label">{status === 'open' ? 'Joining…' : 'Connecting…'}</p>
    </div>
  );
}

function Lobby({
  view,
  code,
  invites,
}: {
  view: TableView;
  code: string;
  invites?: SeatInvite[];
}) {
  return (
    <div className="screen screen--lobby">
      <p className="label">Room code</p>
      <p className="lobby__code">{code}</p>
      <ul className="lobby__seats">
        {view.players.map((player) => {
          const hasCode = !player.connected && invites?.some((i) => i.seat === player.seat);
          return (
            <li
              key={player.seat}
              className={player.connected ? 'is-connected' : hasCode ? 'has-code' : undefined}
            >
              <SeatSlot
                seat={player.seat}
                name={player.connected ? player.name : undefined}
                invites={invites}
              />
            </li>
          );
        })}
      </ul>
      <p className="label screen__footnote">
        {view.players.every((p) => p.connected)
          ? 'Both in. Deal from either phone.'
          : 'Open /play on each phone and enter the code, or scan the code above.'}
      </p>
    </div>
  );
}

function Board({
  view,
  arrivingId,
  onDraw,
}: {
  view: TableView;
  arrivingId: string | null;
  onDraw: (source: DrawSource) => void;
}) {
  const [seat0, seat1] = view.players;
  const active = view.players[view.turn];

  return (
    <>
      <header className="status-bar">
        <span className="label">
          Round {view.round}/3
        </span>
        <div className="status-bar__scores">
          {view.players.map((player) => (
            <span
              key={player.seat}
              className={`score ${view.turn === player.seat ? 'is-active' : ''}`}
            >
              <span className="score__name">{player.name}</span>
              <span className="score__value">
                {player.roundScores.reduce((a, b) => a + b, 0) + player.currentRoundScore}
              </span>
              {!player.connected && <span className="score__offline label">offline</span>}
            </span>
          ))}
        </div>
      </header>

      {/*
        Each side is sized by its own longest column, so a player with a deep
        expedition does not shrink the other's cards.
      */}
      <section
        className="board__side board__side--top"
        style={sideStyle(sideMetrics(COLOURS.map((c) => seat1.expeditions[c].length)))}
        aria-label={`${seat1.name} expeditions`}
      >
        {COLOURS.map((colour) => (
          <Column
            key={colour}
            colour={colour}
            cards={seat1.expeditions[colour]}
            direction="up"
            arrivingId={arrivingId}
          />
        ))}
      </section>

      {/*
        The one interactive thing on the table. The player to move reaches
        for a pile the server has marked legal and pulls it toward their own
        side; see drawGesture.ts for why that is safe where a tap was not.
      */}
      <DiscardRow
        deckCount={view.deckCount}
        discardTops={view.discardTops}
        arrivingId={arrivingId}
        legalDrawSources={view.legalDrawSources}
        activeSeat={view.turn}
        onDraw={onDraw}
      />

      <section
        className="board__side board__side--bottom"
        style={sideStyle(sideMetrics(COLOURS.map((c) => seat0.expeditions[c].length)))}
        aria-label={`${seat0.name} expeditions`}
      >
        {COLOURS.map((colour) => (
          <Column
            key={colour}
            colour={colour}
            cards={seat0.expeditions[colour]}
            direction="down"
            arrivingId={arrivingId}
          />
        ))}
      </section>

      <footer className="turn-bar">
        <span className="turn-bar__who">
          {active.name}
          {"'"}s turn — {view.phase === 'place' ? 'placing a card' : 'drawing a card'}
        </span>
        <span className="label">
          {active.handCount} cards in hand
        </span>
      </footer>
    </>
  );
}
