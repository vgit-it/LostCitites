// The phone controller. Portrait, one thumb, glanceable — the player is
// looking at the table most of the time.
//
// Holds zero rules logic: every legality decision arrives precomputed in
// the view. This component only routes taps to intents.

import { useEffect, useRef, useState } from 'react';
import { Card as CardModel, DrawSource, PlaceTarget, PlayerView, Seat } from '@shared/types';
import {
  vibrateCommit,
  vibrateDraw,
  vibrateReject,
  vibrateTurnStart,
  vibrateZone,
} from '../platform/vibrate';
import { DRAW_FLIGHT_MS, LAND_MS, SHAKE_MS } from '../platform/motion';
import { useWakeLock } from '../platform/wakeLock';
import {
  useClientView,
  useConnectionStatus,
  useSession,
  useSessionError,
  useTableEvents,
} from '../session/useSession';
import { BoardStrip } from './BoardStrip';
import { CardFlight, Rect } from '../shared/CardFlight';
import { DrawTargets } from './DrawTargets';
import { DropZones } from './DropZones';
import { DropZone, Point, chooseDrop } from './gesture';
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

/**
 * The drop zone under a point, or null for neutral space.
 *
 * Hit-tested from here rather than inside Hand for the same reason Hand
 * hit-tests cards through the document: the zones are the parent's, and a
 * hand that knew about them would be a hand that knew what a turn is.
 */
function dropZoneAt(point: Point): DropZone {
  if (typeof document.elementFromPoint !== 'function') return null; // jsdom
  const zone = document
    .elementFromPoint(point.x, point.y)
    ?.closest('[data-drop]')
    ?.getAttribute('data-drop');
  return zone === 'expedition' || zone === 'discard' ? zone : null;
}

/** How long an opponent's move stays on the banner. */
const CUE_MS = 2200;

/** A card in words, for a cue line. */
function describe(card: CardModel): string {
  return card.value === 'wager' ? `a ${card.colour} wager` : `${card.colour} ${card.value}`;
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
  /**
   * The chip a card has just landed on, for one pulse. Sequenced because two
   * cards into the same column is an ordinary pair of turns in this game, and
   * a bare colour would not change between them — so the second play would
   * not flash.
   */
  const [landed, setLanded] = useState<{ colour: CardModel['colour']; seq: number } | null>(null);
  const landSeq = useRef(0);
  /** What the opponent just did, shown briefly in the banner. */
  const [opponentCue, setOpponentCue] = useState<string | null>(null);
  /** The card currently travelling with the thumb, if any. */
  const [lifted, setLifted] = useState<string | null>(null);
  /** Which zone that card is over, so it can light up before the release. */
  const [hoveredZone, setHoveredZone] = useState<DropZone>(null);
  /** A card dropped on a zone that was not offered: shake it home. */
  const [refusingId, setRefusingId] = useState<string | null>(null);

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

  // What the opponent just did. Events rather than a diff of their state,
  // and the distinction is load-bearing: a reconnect delivers a fresh full
  // view that may differ from the last one arbitrarily, and a diff-driven
  // animator would answer it with a flurry of cues for moves that happened
  // minutes ago. Events simply do not have that failure mode.
  //
  // Cosmetic only — the next `state` remains the source of truth for
  // everything shown here.
  useTableEvents((event) => {
    if (!player) return;
    if (event.name === 'placed' && event.seat !== player.seat) {
      setOpponentCue(
        event.target === 'discard'
          ? `discarded ${describe(event.card)}`
          : `played ${describe(event.card)}`,
      );
    }
    if (event.name === 'drew' && event.seat !== player.seat) {
      setOpponentCue(event.source.kind === 'deck' ? 'drew from the deck' : 'took a discard');
    }
  });

  // The cue is a flash, not a log: it clears itself.
  useEffect(() => {
    if (!opponentCue) return;
    const timer = setTimeout(() => setOpponentCue(null), CUE_MS);
    return () => clearTimeout(timer);
  }, [opponentCue]);

  // The landing pulse owns its own clock now: a dropped card has no flight
  // to end, so there is nothing else to clear it.
  useEffect(() => {
    if (!landed) return;
    const timer = setTimeout(() => setLanded(null), LAND_MS + 120);
    return () => clearTimeout(timer);
  }, [landed]);

  // The shake, on its own clock for the same reason.
  useEffect(() => {
    if (!refusingId) return;
    const timer = setTimeout(() => setRefusingId(null), SHAKE_MS);
    return () => clearTimeout(timer);
  }, [refusingId]);

  // The server refused the move: bring the card home and say so.
  useEffect(() => {
    if (!error) return;
    vibrateReject();
    // from/to stay as they were — CardFlight is positioned at `from` and
    // plays its keyframes backwards, so the card returns to the hand.
    setFlight((f) => (f && !f.reversed ? { ...f, reversed: true } : f));
    // A dropped card never flew, so the flight cannot carry the refusal for
    // it. It is still sitting in the hand — the view that would remove it is
    // exactly the one that did not arrive — so shake it where it lies.
    setRefusingId((id) => id ?? selectedId);
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

  /**
   * The one path to a placement, for both routes into it.
   *
   * `fly` is the difference between them. A tapped button leaves the card in
   * the hand, so a copy has to travel to the target; a dropped card is
   * already sitting on the zone, and flying it back to the fan to fly it out
   * again would animate the one journey the player just made by hand.
   */
  function commit(cardId: string, target: PlaceTarget['kind'], fly: boolean): void {
    const card = player?.hand.find((c) => c.id === cardId);
    if (!card) return;

    if (fly) {
      // Measure before sending: on a LAN the server's next state can land
      // before the next frame, and by then the card is out of the hand.
      const from = rectOf(`[data-card-id="${cardId}"]`);
      const to = rectOf(`[data-zone="${target === 'discard' ? 'discard' : card.colour}"]`);
      if (from && to) setFlight({ card, from, to });
    }

    if (target === 'expedition') {
      landSeq.current += 1;
      setLanded({ colour: card.colour, seq: landSeq.current });
    }

    vibrateCommit();
    send(() => session.place(cardId, target));
  }

  const place = (target: PlaceTarget['kind']) => {
    if (selectedId) commit(selectedId, target, true);
  };

  /** A held card moved: light whichever zone is under it, once per crossing. */
  const handleDragMove = (point: Point) => {
    const zone = dropZoneAt(point);
    setHoveredZone((current) => {
      if (current === zone) return current;
      if (zone) vibrateZone();
      return zone;
    });
  };

  /**
   * A held card was let go. Neutral space puts it back — that is the whole
   * cancel gesture, and it is why both commits could be moved to the top.
   */
  const handleRelease = (cardId: string, point: Point | null) => {
    setLifted(null);
    setHoveredZone(null);
    if (!point || busy) return;

    const outcome = chooseDrop(dropZoneAt(point), player?.legalPlacements[cardId] ?? []);
    if (outcome.kind === 'cancel') return;
    if (outcome.kind === 'refuse') {
      // The zone was already visibly dead, so this was deliberate. Say no
      // out loud rather than silently dropping the gesture.
      vibrateReject();
      setRefusingId(cardId);
      return;
    }
    commit(cardId, outcome.target, false);
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

  const liftedCard = lifted ? player.hand.find((c) => c.id === lifted) ?? null : null;

  // The top of the screen is one place with four things to say. Ordered by
  // immediacy: a card in the air outranks a phase, and a phase outranks a
  // selection.
  const trayMode: TrayMode = liftedCard
    ? 'drop'
    : drawing
      ? 'draw'
      : selected && myTurn
        ? 'place'
        : 'table';

  return (
    <div className="phone">
      <Banner player={player} myTurn={myTurn} status={status} cue={opponentCue} />
      {error && (
        <button type="button" className="toast" onClick={() => session.dismissError()}>
          {error}
        </button>
      )}

      {player.stage === 'lobby' && <LobbyPanel onDeal={() => session.startRound()} />}

      {player.stage === 'playing' && (
        <>
          <Tray mode={trayMode}>
            {trayMode === 'drop' && liftedCard ? (
              <DropZones
                card={liftedCard}
                targets={player.legalPlacements[liftedCard.id] ?? []}
                column={me.expeditions[liftedCard.colour]}
                hovered={hoveredZone}
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
              // Both 'table' and 'draw'. The row is the same furniture
              // either way; the draw phase only makes it tappable.
              <DrawTargets
                deckCount={player.deckCount}
                discardTops={player.discardTops}
                legalDrawSources={player.legalDrawSources}
                blockedDrawCardId={player.blockedDrawCardId}
                busy={busy}
                interactive={drawing}
                onDraw={draw}
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
            away={!myTurn}
            refusingId={refusingId}
            onLift={setLifted}
            onDragMove={handleDragMove}
            onRelease={handleRelease}
          />

          {/*
            Your own side of the table, and the answer to the question the
            draw phase used to leave unanswerable: taking the green 8 is a
            good idea or a dead card entirely depending on where your green
            column stands, and this is now on screen while you decide.
          */}
          <BoardStrip
            expeditions={me.expeditions}
            score={me.currentRoundScore}
            flashColour={landed?.colour ?? null}
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
  cue,
}: {
  player: PlayerView;
  myTurn: boolean;
  status: string;
  cue?: string | null;
}) {
  const opponent = player.players[player.seat === 0 ? 1 : 0];

  const turnMessage = !myTurn
    ? `${opponent.name} is ${player.phase === 'place' ? 'placing' : 'drawing'}`
    : player.phase === 'place'
      ? 'Your turn — place a card'
      : 'Your turn — draw a card';

  const message = cue ? `${opponent.name} ${cue}` : turnMessage;

  return (
    // aria-live so a turn handover and an opponent's move both announce
    // themselves without stealing focus.
    <header className={`banner ${myTurn ? 'is-active' : ''}`} aria-live="polite">
      <span className={`banner__message${cue ? ' is-cue' : ''}`}>
        {player.stage === 'playing' ? message : 'Lost Cities'}
      </span>
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
