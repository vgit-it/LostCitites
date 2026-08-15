// The shared table display. Landscape, read to from ~1 metre.
//
// Very nearly input-free, and for the original reason: nothing here responds
// to a tap, so leaning on the tablet cannot change the game. The single
// exception is the reach for a card during a draw phase — see
// drawGesture.ts, which explains why a directional pull is safe where a tap
// would not have been.

import { useEffect, useRef, useState } from 'react';
import {
  COLOURS,
  Card as CardModel,
  Colour,
  DrawSource,
  PublicPlayerView,
  Seat,
  TableView,
} from '@shared/types';
import { scoreExpedition } from '@shared/rules';
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

/**
 * One player's name, running score, and (only while it is theirs) the turn
 * and phase. Sits at the outer edge of that player's own side.
 *
 * `flipped` turns the whole plate to face the player sitting opposite —
 * scoped to this leaf alone, never to `.board__side` itself: that element
 * already owns a `translateX` for its stair, and rotating an ancestor of a
 * `position: fixed` `CardFlight` would make it a containing block. Neither
 * risk exists here — a name plate has no positioned descendants.
 */
export function SeatPlate({
  player,
  active,
  phase,
  flipped,
}: {
  player: PublicPlayerView;
  active: boolean;
  phase: TableView['phase'];
  flipped: boolean;
}) {
  return (
    <div
      className={`seat-plate${active ? ' is-active' : ''}${flipped ? ' seat-plate--flipped' : ''}`}
    >
      <span className="seat-plate__name">{player.name}</span>
      <span className="seat-plate__score">
        {player.roundScores.reduce((a, b) => a + b, 0) + player.currentRoundScore}
      </span>
      {active && (
        <span className="seat-plate__turn label">
          {phase === 'place' ? 'Placing a card' : 'Drawing a card'} · {player.handCount} in hand
        </span>
      )}
      {!player.connected && <span className="seat-plate__offline label">offline</span>}
    </div>
  );
}

/**
 * One band of the name row: the round counter's gutter cell (top only, and
 * never rotated — it belongs to the table, not to a player) plus the plate,
 * spanning the five colour tracks so it lines up with nothing in particular
 * and reads centred above/below the board.
 */
function NameRow({
  player,
  active,
  phase,
  flipped,
  round,
}: {
  player: PublicPlayerView;
  active: boolean;
  phase: TableView['phase'];
  flipped: boolean;
  /** Only the top row carries this — one counter for the whole table. */
  round?: number;
}) {
  return (
    <div className={`name-row name-row--${flipped ? 'top' : 'bottom'}`}>
      {round !== undefined && (
        <span className="round-chip label" style={{ gridColumn: 1 }}>
          Round {round}/3
        </span>
      )}
      <SeatPlate player={player} active={active} phase={phase} flipped={flipped} />
    </div>
  );
}

/**
 * One track's worth of a side: the column and, on the edge facing the
 * centre, that expedition's live score. The score is a sibling of `Column`,
 * not a child — `.column` already carries `translateX(-half its stair)`, so
 * a score inside it would drift left as the expedition grew and stop
 * sitting over its own discard pile.
 */
export function Lane({
  colour,
  cards,
  direction,
  arrivingId,
}: {
  colour: Colour;
  cards: CardModel[];
  direction: 'up' | 'down';
  arrivingId: string | null;
}) {
  // `RoundEnd.tsx` is the precedent for this import: display recomputation
  // of a pure formula against cards the view already carries, not client
  // rules logic.
  const score = cards.length > 0 ? scoreExpedition(cards) : null;
  const scoreLabel = score !== null && (
    <span className={`lane__score${score < 0 ? ' is-negative' : ''}`}>
      {score > 0 ? `+${score}` : score}
    </span>
  );

  return (
    <div
      className={`lane lane--${direction === 'up' ? 'top' : 'bottom'}`}
      // Shared six-track template (.board's --board-cols): track 1 is the
      // deck's gutter, tracks 2..6 are the five colours in COLOURS order —
      // the same order the discard row's piles fall into by DOM position
      // alone. A side has no gutter-occupying child, so its lanes need this
      // set explicitly or grid auto-placement would pack them into 1..5.
      style={{ gridColumn: COLOURS.indexOf(colour) + 2 }}
    >
      {direction === 'up' && scoreLabel}
      <Column colour={colour} cards={cards} direction={direction} arrivingId={arrivingId} />
      {direction === 'down' && scoreLabel}
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

  return (
    <div className="board">
      <NameRow player={seat1} active={view.turn === 1} phase={view.phase} flipped round={view.round} />

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
          <Lane
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
          <Lane
            key={colour}
            colour={colour}
            cards={seat0.expeditions[colour]}
            direction="down"
            arrivingId={arrivingId}
          />
        ))}
      </section>

      <NameRow player={seat0} active={view.turn === 0} phase={view.phase} flipped={false} />
    </div>
  );
}
