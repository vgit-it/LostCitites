// The phone controller: a hand of cards, held upright, and nothing else.
//
// No deck, no discards, no expedition columns. All of that is on the table
// the player is already looking at, and putting a small copy of it here was
// asking them to play the game twice. What is left is the one thing only this
// device can hold: the cards nobody else may see.
//
// Holds zero rules logic: every legality decision arrives precomputed in the
// view. This component only turns throws into intents.

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Card as CardModel, DrawSource, PlaceTarget, PlayerView, Seat } from '@shared/types';
import { vibrateCommit, vibrateDraw, vibrateReject, vibrateTurnStart } from '../platform/vibrate';
import { DRAW_FLIGHT_MS, SHAKE_MS } from '../platform/motion';
import { usePortraitLock } from '../platform/orientation';
import { useWakeLock } from '../platform/wakeLock';
import {
  useClientView,
  useConnectionStatus,
  useServerSeq,
  useSession,
  useSessionError,
  useTableEvents,
} from '../session/useSession';
import { CardFlight, Rect } from '../shared/CardFlight';
import { edgeRect } from '../shared/flightPath';
import { Invite, resolveInvite } from '../shared/invite';
import { Throw } from './throw';
import { FlickZones } from './FlickZones';
import { Hand, drawnCardId } from './Hand';
import { HandActions } from './HandActions';
import { JoinScreen } from './JoinScreen';

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

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** How long an opponent's move stays on the headline. */
const CUE_MS = 2200;

/** Degrees a thrown card tumbles, turning the way it was thrown. */
const THROW_SPIN = 26;

/** A card in words, for a cue line. */
function describe(card: CardModel): string {
  return card.value === 'wager' ? `a ${card.colour} wager` : `${card.colour} ${card.value}`;
}

interface Flight {
  card: CardModel;
  from: Rect;
  to: Rect;
  kind?: 'land' | 'throw';
  spin?: number;
  reversed?: boolean;
  durationMs?: number;
}

export function Phone({
  invite = null,
  lastName = '',
}: {
  /** What a scanned QR asked for, if this device opened one. */
  invite?: Invite | null;
  /** This device's name from a previous game, offered as a default. */
  lastName?: string;
} = {}) {
  const session = useSession();
  const view = useClientView();
  const status = useConnectionStatus();
  const error = useSessionError();
  const seq = useServerSeq();
  useWakeLock();
  usePortraitLock();

  /** Set on send, cleared by the next view — stops a double throw. */
  const [busy, setBusy] = useState(false);
  /**
   * Owned here and deliberately *not* cleared by the [view] effect: a flight
   * outlives the state change that caused it, and ends on its own promise.
   */
  const [flight, setFlight] = useState<Flight | null>(null);
  /** What the opponent just did, shown briefly in place of the headline. */
  const [opponentCue, setOpponentCue] = useState<string | null>(null);
  /** The card currently up under the finger, if any. */
  const [carried, setCarried] = useState<string | null>(null);
  /** Which way it is leaning, so the wash behind it can arm. */
  const [armed, setArmed] = useState<PlaceTarget['kind'] | null>(null);
  /** A card thrown at a direction that was not offered: shake it home. */
  const [refusingId, setRefusingId] = useState<string | null>(null);

  const player = view?.viewer === 'player' ? view : null;
  const myTurn = player ? player.turn === player.seat : false;

  /** Last hand seen, so an arrival can be spotted without deriving state. */
  const prevHand = useRef<CardModel[]>([]);

  // Buzz when the turn flips to this phone. The screen is often off.
  useEffect(() => {
    if (myTurn) vibrateTurnStart();
  }, [myTurn]);

  // Cleared by any server reply, not only a fresh view: a rejected `place`
  // or `draw` replies with only an `error` (server/room.ts does not
  // broadcast on a refusal), and keying this on `view` left `busy` — and so
  // the whole hand — stuck true forever after exactly one refusal, since
  // nothing else on your own turn produces a new `state`.
  useEffect(() => {
    setBusy(false);
  }, [seq]);

  // A card arriving in this hand — drawn on the table, so it comes in over
  // the top edge, which is the direction the table is in. Driven by a diff
  // rather than an event because we know it is ours and drawnCardId refuses
  // anything that is not a clean single arrival, so a reconnect's fresh view
  // cannot trigger it.
  useEffect(() => {
    if (!player) return;
    const arrived = drawnCardId(prevHand.current, player.hand);
    prevHand.current = player.hand;

    if (!arrived) return;
    vibrateDraw();

    const card = player.hand.find((c) => c.id === arrived);
    const to = rectOf(`[data-card-id="${arrived}"]`);
    if (card && to) {
      setFlight({ card, from: edgeRect(to, 'top', viewport()), to, durationMs: DRAW_FLIGHT_MS });
    }
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

  // The shake, on its own clock: a refused card never flew, so there is no
  // flight ending to clear it.
  useEffect(() => {
    if (!refusingId) return;
    const timer = setTimeout(() => setRefusingId(null), SHAKE_MS);
    return () => clearTimeout(timer);
  }, [refusingId]);

  // The server refused the move: bring the card home and say so.
  //
  // Keyed on `seq`, not `error`: two identical refusals in a row hold the
  // same string, useSyncExternalStore bails on that with Object.is, and an
  // effect keyed on `error` itself would then simply never re-fire for the
  // second one — no buzz, no reversed flight, indistinguishable from the
  // throw having been silently ignored.
  useEffect(() => {
    if (!error) return;
    vibrateReject();
    // from/to stay as they were — CardFlight is positioned at `from` and
    // plays its keyframes backwards, so the card flies back in.
    setFlight((f) => (f && !f.reversed ? { ...f, reversed: true } : f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  const invited = resolveInvite(invite, session.getCode());

  if (!session.getCode() || invited) {
    return (
      <JoinScreen
        initialCode={invited?.code ?? ''}
        initialSeat={invited?.seat ?? 0}
        initialName={lastName}
        onJoin={(code, seat, name) => session.joinPlayer(code, seat, name)}
      />
    );
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
   * The one path to a placement, for both the throw and the accessible
   * buttons.
   *
   * The card is measured where it currently is — mid-carry that is under the
   * finger, from a button it is still in the row — and thrown from there off
   * the corresponding edge. Measuring before sending matters: on a LAN the
   * server's next state can land before the next frame, and by then the card
   * is out of the hand and there is nothing left to measure.
   */
  function commit(cardId: string, target: PlaceTarget['kind']): void {
    const card = player?.hand.find((c) => c.id === cardId);
    if (!card) return;

    const from = rectOf(`[data-card-id="${cardId}"]`);
    if (from) {
      const edge = target === 'discard' ? 'left' : 'right';
      setFlight({
        card,
        from,
        to: edgeRect(from, edge, viewport()),
        kind: 'throw',
        spin: target === 'discard' ? -THROW_SPIN : THROW_SPIN,
      });
    }

    vibrateCommit();
    send(() => session.place(cardId, target));
  }

  /**
   * A carried card was let go. Only a throw commits; anything else puts the
   * card back, which is the whole cancel gesture.
   *
   * Shakes the same card twice in a row without a flicker: setting the same
   * id twice is a no-op re-render (Object.is bails), so the CSS animation
   * would never restart for a repeated refusal of the same card. flushSync
   * forces a real intermediate render with no card refusing, so the second
   * `is-refusing` is a genuine mount rather than an unchanged one.
   */
  function shake(cardId: string): void {
    vibrateReject();
    flushSync(() => setRefusingId(null));
    setRefusingId(cardId);
  }

  const handleThrow = (cardId: string, outcome: Throw) => {
    setCarried(null);
    setArmed(null);
    if (outcome === 'return') return;
    if (busy) {
      // A legal throw that lands mid round-trip is a real, deliberate move,
      // not nothing — silently dropping it here (as `|| busy` used to)
      // looked exactly like the gesture had been ignored.
      shake(cardId);
      return;
    }
    if (outcome === 'refuse') {
      // The wash was already visibly dead, so this was deliberate. Say no out
      // loud rather than silently dropping the gesture.
      shake(cardId);
      return;
    }
    commit(cardId, outcome);
  };

  const draw = (source: DrawSource) => send(() => session.draw(source));

  const me = player.players[player.seat];
  const opponent = player.players[player.seat === 0 ? 1 : 0];
  const drawing = myTurn && player.phase === 'draw';
  const carriedCard = carried ? player.hand.find((c) => c.id === carried) ?? null : null;

  const headline = opponentCue
    ? `${opponent.name} ${opponentCue}`
    : !myTurn
      ? `${opponent.name}’s turn`
      : drawing
        ? 'Pick a card from the board'
        : 'Play card';

  return (
    <div className="phone">
      <RotateGate />

      {/*
        aria-live so a turn handover and an opponent's move both announce
        themselves without stealing focus.
      */}
      <header className={`headline ${myTurn ? 'is-active' : ''}`} aria-live="polite">
        <span className={`headline__text${opponentCue ? ' is-cue' : ''}`}>
          {player.stage === 'playing' ? headline : 'Lost Cities'}
        </span>
        {status !== 'open' && <span className="label">reconnecting…</span>}
      </header>

      {error && (
        <button type="button" className="toast" onClick={() => session.dismissError()}>
          {error}
        </button>
      )}

      {player.stage === 'lobby' && <LobbyPanel onDeal={() => session.startRound()} />}

      {player.stage === 'playing' && (
        <>
          {/*
            Behind the hand, and only while a card is up: the two directions
            that card can go. Not drop targets — see FlickZones.
          */}
          {carriedCard && (
            <FlickZones
              card={carriedCard}
              targets={player.legalPlacements[carriedCard.id] ?? []}
              column={me.expeditions[carriedCard.colour]}
              armed={armed}
            />
          )}

          {/*
            The hand stays mounted through the draw phase and through the
            opponent's turn — dimmed and inert rather than swapped out.
          */}
          <Hand
            cards={player.hand}
            legalPlacements={player.legalPlacements}
            disabled={busy}
            muted={!myTurn || drawing}
            away={!myTurn}
            refusingId={refusingId}
            onCarry={setCarried}
            onArmed={setArmed}
            onThrow={handleThrow}
          />

          <HandActions
            hand={player.hand}
            legalPlacements={player.legalPlacements}
            legalDrawSources={player.legalDrawSources}
            discardTops={player.discardTops}
            deckCount={player.deckCount}
            phase={player.phase}
            myTurn={myTurn}
            busy={busy}
            onPlace={commit}
            onDraw={draw}
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
          kind={flight.kind}
          spin={flight.spin}
          reversed={flight.reversed}
          durationMs={flight.durationMs}
          onDone={() => setFlight(null)}
        />
      )}
    </div>
  );
}

/**
 * Shown only in portrait, by CSS alone.
 *
 * No orientation listener and no JS branch: a media query cannot get out of
 * step with the layout it is guarding, and the layout below it is landscape
 * from top to bottom.
 */
function RotateGate() {
  return (
    <div className="rotate-gate">
      <span className="rotate-gate__mark" aria-hidden="true">
        ⟳
      </span>
      <p className="rotate-gate__text">Hold your phone upright</p>
    </div>
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
      <button type="button" className="action action--play" disabled={ready} onClick={onReady}>
        {ready ? 'Waiting for the other player…' : 'Ready for the next round'}
      </button>
    </div>
  );
}
