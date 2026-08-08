// The phone controller. Portrait, one thumb, glanceable — the player is
// looking at the table most of the time.
//
// Holds zero rules logic: every legality decision arrives precomputed in
// the view. This component only routes taps to intents.

import { useEffect, useRef, useState } from 'react';
import { Card as CardModel, DrawSource, PlaceTarget, PlayerView, Seat } from '@shared/types';
import { vibrateCommit, vibrateDraw, vibrateReject, vibrateTurnStart } from '../platform/vibrate';
import { DRAW_FLIGHT_MS } from '../platform/motion';
import { useWakeLock } from '../platform/wakeLock';
import {
  useClientView,
  useConnectionStatus,
  useSession,
  useSessionError,
} from '../session/useSession';
import { BoardStrip } from './BoardStrip';
import { CardFlight, Rect } from './CardFlight';
import { DrawTargets } from './DrawTargets';
import { Hand, drawnCardId } from './Hand';
import { PlaceActions } from './PlaceActions';
import { JoinScreen } from './JoinScreen';
import { Tray, TrayMode } from './Tray';

/**
 * A live element's rect, or null when there is nothing to measure.
 *
 * The zero-width guard doubles as the reason flights simply do not happen
 * under test: jsdom implements no layout, so every rect comes back zeroed.
 */
function rectOf(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
}

interface Flight {
  card: CardModel;
  from: Rect;
  to: Rect;
  reversed?: boolean;
  durationMs?: number;
}

export function Phone() {
  const session = useSession();
  const view = useClientView();
  const status = useConnectionStatus();
  const error = useSessionError();
  useWakeLock();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Set on send, cleared by the next view — stops double taps. */
  const [busy, setBusy] = useState(false);
  /**
   * Owned here and deliberately *not* cleared by the [view] effect: a flight
   * outlives the state change that caused it, and ends on its own promise.
   */
  const [flight, setFlight] = useState<Flight | null>(null);
  /** The chip that a card has just landed on, for one pulse. */
  const [landed, setLanded] = useState<CardModel['colour'] | null>(null);

  const player = view?.viewer === 'player' ? view : null;
  const myTurn = player ? player.turn === player.seat : false;

  /** Last hand seen, so an arrival can be spotted without deriving state. */
  const prevHand = useRef<CardModel[]>([]);
  /** Where the last draw was tapped, so its flight has a source. */
  const drawFrom = useRef<Rect | null>(null);

  // Buzz when the turn flips to this phone. The screen is often off.
  useEffect(() => {
    if (myTurn) vibrateTurnStart();
  }, [myTurn]);

  // Every new view is the server's answer to *someone's* intent — the
  // opponent's moves land here too, and those cannot invalidate a card still
  // sitting in your hand. Dropping the selection unconditionally meant the
  // card you were holding fell out of your hand whenever they moved.
  useEffect(() => {
    setBusy(false);
    setSelectedId((id) => (id && player?.hand.some((c) => c.id === id) ? id : null));
  }, [view]);

  // A card arriving in this hand. Driven by a diff rather than an event
  // because we know it is ours and drawnCardId refuses anything that is not
  // a clean single arrival — so a reconnect's fresh view cannot trigger it.
  useEffect(() => {
    if (!player) return;
    const arrived = drawnCardId(prevHand.current, player.hand);
    prevHand.current = player.hand;

    if (!arrived) return;
    vibrateDraw();

    const card = player.hand.find((c) => c.id === arrived);
    const to = rectOf(`[data-card-id="${arrived}"]`);
    const from = drawFrom.current;
    drawFrom.current = null;
    if (card && from && to) setFlight({ card, from, to, durationMs: DRAW_FLIGHT_MS });
  }, [view]);

  // The server refused the move: bring the card home and say so.
  useEffect(() => {
    if (!error) return;
    vibrateReject();
    // from/to stay as they were — CardFlight is positioned at `from` and
    // plays its keyframes backwards, so the card returns to the hand.
    setFlight((f) => (f && !f.reversed ? { ...f, reversed: true } : f));
  }, [error]);

  if (!session.getCode()) {
    return <JoinScreen onJoin={(code, seat, name) => session.joinPlayer(code, seat, name)} />;
  }

  if (!player) {
    return (
      <div className="phone phone--waiting">
        <p className="label">{status === 'open' ? 'Joining…' : 'Connecting…'}</p>
      </div>
    );
  }

  function send(action: () => void): void {
    setBusy(true);
    action();
  }

  const place = (target: PlaceTarget['kind']) => {
    const card = player?.hand.find((c) => c.id === selectedId);
    if (!selectedId || !card) return;

    // Measure before sending: on a LAN the server's next state can land
    // before the next frame, and by then the card is out of the hand.
    const from = rectOf(`[data-card-id="${selectedId}"]`);
    const to = rectOf(`[data-zone="${target === 'discard' ? 'discard' : card.colour}"]`);
    if (from && to) {
      setFlight({ card, from, to });
      if (target === 'expedition') setLanded(card.colour);
    }

    vibrateCommit();
    send(() => session.place(selectedId, target));
  };

  const draw = (source: DrawSource) => {
    drawFrom.current = rectOf(
      source.kind === 'deck' ? '.draw-deck' : `[data-draw="${source.colour}"]`,
    );
    send(() => session.draw(source));
  };

  const me = player.players[player.seat];
  const drawing = myTurn && player.phase === 'draw';
  // Derived, not asserted: during the window between sending a placement and
  // the server's answer the card is genuinely gone from the hand.
  const selected = player.hand.find((c) => c.id === selectedId) ?? null;

  const trayMode: TrayMode = drawing ? 'draw' : selected && myTurn ? 'place' : 'board';

  return (
    <div className="phone">
      <Banner player={player} myTurn={myTurn} status={status} />
      {error && (
        <button type="button" className="toast" onClick={() => session.dismissError()}>
          {error}
        </button>
      )}

      {player.stage === 'lobby' && <LobbyPanel onDeal={() => session.startRound()} />}

      {player.stage === 'playing' && (
        <>
          <Tray mode={trayMode}>
            {trayMode === 'draw' ? (
              <DrawTargets
                deckCount={player.deckCount}
                discardTops={player.discardTops}
                legalDrawSources={player.legalDrawSources}
                blockedDrawCardId={player.blockedDrawCardId}
                busy={busy}
                onDraw={draw}
              />
            ) : trayMode === 'place' && selected ? (
              <PlaceActions
                card={selected}
                targets={player.legalPlacements[selected.id] ?? []}
                column={me.expeditions[selected.colour]}
                busy={busy}
                onPlace={place}
              />
            ) : (
              <BoardStrip
                expeditions={me.expeditions}
                score={me.currentRoundScore}
                flashColour={landed}
              />
            )}
          </Tray>

          {/*
            The hand stays mounted through the draw phase and through the
            opponent's turn — receded and inert rather than swapped out. The
            hard unmount was most of why this screen read as a form.
          */}
          <Hand
            cards={player.hand}
            legalPlacements={player.legalPlacements}
            selectedId={selectedId}
            onSelect={setSelectedId}
            disabled={busy}
            muted={!myTurn || drawing}
          />
        </>
      )}

      {(player.stage === 'roundEnd' || player.stage === 'matchEnd') && (
        <RoundGate view={player} onReady={() => session.readyNextRound()} />
      )}

      {flight && (
        <CardFlight
          // Keyed so a reversal remounts and replays rather than being
          // ignored by an effect that has already run.
          key={`${flight.card.id}-${flight.reversed ? 'back' : 'out'}`}
          card={flight.card}
          from={flight.from}
          to={flight.to}
          reversed={flight.reversed}
          durationMs={flight.durationMs}
          onDone={() => {
            setFlight(null);
            setLanded(null);
          }}
        />
      )}
    </div>
  );
}

function Banner({
  player,
  myTurn,
  status,
}: {
  player: PlayerView;
  myTurn: boolean;
  status: string;
}) {
  const opponent = player.players[player.seat === 0 ? 1 : 0];

  const message = !myTurn
    ? `${opponent.name} is ${player.phase === 'place' ? 'placing' : 'drawing'}`
    : player.phase === 'place'
      ? 'Your turn — place a card'
      : 'Your turn — draw a card';

  return (
    <header className={`banner ${myTurn ? 'is-active' : ''}`}>
      <span className="banner__message">{player.stage === 'playing' ? message : 'Lost Cities'}</span>
      <span className="label">
        {status !== 'open' ? 'reconnecting…' : `deck ${player.deckCount}`}
      </span>
    </header>
  );
}

function LobbyPanel({ onDeal }: { onDeal: () => void }) {
  return (
    <div className="phone__panel">
      <p className="label">Waiting for both seats.</p>
      <button type="button" className="action action--play" onClick={onDeal}>
        Deal the first round
      </button>
    </div>
  );
}

function RoundGate({ view, onReady }: { view: PlayerView; onReady: () => void }) {
  const ready = view.readyForNextRound[view.seat as Seat];
  const scored = view.players[view.seat].roundScores.at(-1) ?? 0;

  if (view.stage === 'matchEnd') {
    return (
      <div className="phone__panel">
        <p className="label">Match over</p>
        <p className="phone__score">
          {view.players[view.seat].roundScores.reduce((a, b) => a + b, 0)}
        </p>
        <p className="label">Check the table for the full result.</p>
      </div>
    );
  }

  return (
    <div className="phone__panel">
      <p className="label">Round {view.round} scored</p>
      <p className="phone__score">{scored}</p>
      <button
        type="button"
        className="action action--play"
        disabled={ready}
        onClick={onReady}
      >
        {ready ? 'Waiting for the other player…' : 'Ready for the next round'}
      </button>
    </div>
  );
}
