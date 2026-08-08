// The phone controller. Portrait, one thumb, glanceable — the player is
// looking at the table most of the time.
//
// Holds zero rules logic: every legality decision arrives precomputed in
// the view. This component only routes taps to intents.

import { useEffect, useState } from 'react';
import { PlaceTarget, PlayerView, Seat } from '@shared/types';
import { vibrateTurnStart } from '../platform/vibrate';
import { useWakeLock } from '../platform/wakeLock';
import {
  useClientView,
  useConnectionStatus,
  useSession,
  useSessionError,
} from '../session/useSession';
import { BoardStrip } from './BoardStrip';
import { DrawTargets } from './DrawTargets';
import { Hand } from './Hand';
import { PlaceActions } from './PlaceActions';
import { JoinScreen } from './JoinScreen';
import { Tray, TrayMode } from './Tray';

export function Phone() {
  const session = useSession();
  const view = useClientView();
  const status = useConnectionStatus();
  const error = useSessionError();
  useWakeLock();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Set on send, cleared by the next view — stops double taps. */
  const [busy, setBusy] = useState(false);

  const player = view?.viewer === 'player' ? view : null;
  const myTurn = player ? player.turn === player.seat : false;

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
    if (!selectedId) return;
    send(() => session.place(selectedId, target));
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
                onDraw={(source) => send(() => session.draw(source))}
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
              <BoardStrip expeditions={me.expeditions} score={me.currentRoundScore} />
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
