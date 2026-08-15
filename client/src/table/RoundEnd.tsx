// Round-end and match-end screens. Shows the arithmetic, not just totals —
// people want to see why they lost (BUILD_SPEC §7).
//
// One of two client files that import rules.ts — this one and Table.tsx,
// both for `scoreExpedition` alone. scoreBreakdown/scorePlayer take a
// PlayerState, which the wire views do not carry. This is display
// recomputation of a pure formula, not client rules.

import { scoreExpedition } from '@shared/rules';
import {
  BONUS_POINTS,
  BONUS_THRESHOLD,
  COLOURS,
  Card,
  Colour,
  EXPEDITION_COST,
  PublicPlayerView,
  Seat,
} from '@shared/types';

interface ColumnMaths {
  colour: Colour;
  started: boolean;
  numbers: number[];
  sum: number;
  wagers: number;
  bonus: boolean;
  score: number;
}

/** Derives the shown arithmetic from the same column the server scored. */
function columnMaths(colour: Colour, column: Card[]): ColumnMaths {
  const numbers = column.filter((c) => c.value !== 'wager').map((c) => c.value as number);
  return {
    colour,
    started: column.length > 0,
    numbers,
    sum: numbers.reduce((a, b) => a + b, 0),
    wagers: column.filter((c) => c.value === 'wager').length,
    bonus: column.length >= BONUS_THRESHOLD,
    score: scoreExpedition(column),
  };
}

function ColumnLine({ maths }: { maths: ColumnMaths }) {
  if (!maths.started) {
    return (
      <tr className="breakdown__row is-untouched">
        <th scope="row">{maths.colour}</th>
        <td colSpan={3}>—</td>
        <td className="breakdown__score">0</td>
      </tr>
    );
  }

  const subtotal = maths.sum - EXPEDITION_COST;
  return (
    <tr className="breakdown__row">
      <th scope="row">{maths.colour}</th>
      <td>
        {maths.numbers.length > 0 ? `${maths.numbers.join(' + ')} = ${maths.sum}` : 'no numbers'}
      </td>
      <td>
        − {EXPEDITION_COST} = {subtotal}
      </td>
      <td>
        {maths.wagers > 0 ? `× ${maths.wagers + 1}` : '× 1'}
        {maths.bonus ? ` + ${BONUS_POINTS}` : ''}
      </td>
      <td className="breakdown__score">{maths.score}</td>
    </tr>
  );
}

export function PlayerBreakdown({ player }: { player: PublicPlayerView }) {
  const rows = COLOURS.map((colour) => columnMaths(colour, player.expeditions[colour]));
  const total = rows.reduce((acc, row) => acc + row.score, 0);

  return (
    <section className="breakdown">
      <h2 className="breakdown__name">{player.name}</h2>
      <table>
        <tbody>
          {rows.map((maths) => (
            <ColumnLine key={maths.colour} maths={maths} />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Round</th>
            <td colSpan={3} />
            <td className="breakdown__score breakdown__score--total">{total}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

export function RoundEnd({
  round,
  players,
  ready,
}: {
  round: number;
  players: [PublicPlayerView, PublicPlayerView];
  ready: [boolean, boolean];
}) {
  return (
    <div className="screen screen--round-end">
      <h1 className="screen__title">Round {round} scored</h1>
      <div className="breakdown-pair">
        <PlayerBreakdown player={players[0]} />
        <PlayerBreakdown player={players[1]} />
      </div>
      <p className="label screen__footnote">
        {ready[0] && ready[1]
          ? 'Dealing…'
          : `Waiting for ${players
              .filter((_, seat) => !ready[seat as Seat])
              .map((p) => p.name)
              .join(' and ')}`}
      </p>
    </div>
  );
}

export function MatchEnd({ players }: { players: [PublicPlayerView, PublicPlayerView] }) {
  const totals = players.map((p) => p.roundScores.reduce((a, b) => a + b, 0)) as [number, number];
  const winner = totals[0] === totals[1] ? null : totals[0] > totals[1] ? 0 : 1;

  return (
    <div className="screen screen--match-end">
      <h1 className="screen__title">
        {winner === null ? 'A tie' : `${players[winner].name} wins`}
      </h1>
      <table className="match-table">
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">R1</th>
            <th scope="col">R2</th>
            <th scope="col">R3</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {players.map((player, seat) => (
            <tr key={player.seat} className={winner === seat ? 'is-winner' : undefined}>
              <th scope="row">{player.name}</th>
              {[0, 1, 2].map((round) => (
                <td key={round}>{player.roundScores[round] ?? '—'}</td>
              ))}
              <td className="breakdown__score breakdown__score--total">{totals[seat]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
