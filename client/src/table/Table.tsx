// The shared table display. Landscape, read to from ~1 metre, and
// deliberately input-free: no tap does anything, so leaning on the tablet
// cannot change the game.

import { useEffect } from 'react';
import { COLOURS, TableView } from '@shared/types';
import { useClientView, useConnectionStatus, useSession } from '../session/useSession';
import { useWakeLock } from '../platform/wakeLock';
import { Column } from './Column';
import { DiscardRow } from './DiscardRow';
import { MatchEnd, RoundEnd } from './RoundEnd';

export function Table({ code }: { code: string }) {
  const session = useSession();
  const view = useClientView();
  const status = useConnectionStatus();
  useWakeLock();

  // The table claims its room once, and re-claims automatically on reconnect.
  useEffect(() => {
    if (session.getCode() !== code) session.joinTable(code);
  }, [session, code]);

  if (!view || view.viewer !== 'table') {
    return <Waiting code={code} status={status} />;
  }

  return (
    <div className="table">
      {status !== 'open' && <div className="reconnect-bar label">Reconnecting…</div>}
      {view.stage === 'lobby' && <Lobby view={view} code={code} />}
      {view.stage === 'playing' && <Board view={view} />}
      {view.stage === 'roundEnd' && (
        <RoundEnd round={view.round} players={view.players} ready={view.readyForNextRound} />
      )}
      {view.stage === 'matchEnd' && <MatchEnd players={view.players} />}
    </div>
  );
}

function Waiting({ code, status }: { code: string; status: string }) {
  return (
    <div className="screen screen--lobby">
      <p className="label">Room code</p>
      <p className="lobby__code">{code}</p>
      <p className="label">{status === 'open' ? 'Joining…' : 'Connecting…'}</p>
    </div>
  );
}

function Lobby({ view, code }: { view: TableView; code: string }) {
  return (
    <div className="screen screen--lobby">
      <p className="label">Room code</p>
      <p className="lobby__code">{code}</p>
      <ul className="lobby__seats">
        {view.players.map((player) => (
          <li key={player.seat} className={player.connected ? 'is-connected' : undefined}>
            <span className="lobby__dot" aria-hidden="true" />
            {player.connected ? player.name : `Seat ${player.seat + 1} — waiting`}
          </li>
        ))}
      </ul>
      <p className="label screen__footnote">
        {view.players.every((p) => p.connected)
          ? 'Both in. Deal from either phone.'
          : 'Open /play on each phone and enter the code.'}
      </p>
    </div>
  );
}

function Board({ view }: { view: TableView }) {
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

      <section className="board__side board__side--top" aria-label={`${seat1.name} expeditions`}>
        {COLOURS.map((colour) => (
          <Column key={colour} colour={colour} cards={seat1.expeditions[colour]} direction="up" />
        ))}
      </section>

      <DiscardRow deckCount={view.deckCount} discardTops={view.discardTops} />

      <section
        className="board__side board__side--bottom"
        aria-label={`${seat0.name} expeditions`}
      >
        {COLOURS.map((colour) => (
          <Column
            key={colour}
            colour={colour}
            cards={seat0.expeditions[colour]}
            direction="down"
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
