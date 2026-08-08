// The player's own five expeditions, compressed to a row of chips, plus the
// live round score.
//
// Two jobs. It is information the phone deliberately did not show before —
// you had to look up at the table to know where your own columns stood. And
// it is what a played card flies *to*, which is why each chip is addressable
// by data-zone.
//
// Presentational: no rules logic. `topOf` reads a column back; it does not
// decide anything about legality.

import { COLOURS, Card as CardModel, Colour } from '@shared/types';
import { COLOUR_MARK } from '../shared/Card';

export interface BoardStripProps {
  expeditions: Record<Colour, CardModel[]>;
  /** Live, from the server — never recomputed here. */
  score: number;
  /** Briefly flashed after a card lands. */
  flashColour?: Colour | null;
}

/** The highest number played in a column, or null for an unstarted one. */
export function topOf(column: CardModel[]): number | null {
  const numbers = column.filter((c) => c.value !== 'wager');
  return numbers.length === 0 ? null : (numbers[numbers.length - 1].value as number);
}

/** How many wagers lead a column — the multiplier, shown as ×2/×3/×4. */
export function wagersIn(column: CardModel[]): number {
  return column.filter((c) => c.value === 'wager').length;
}

export function BoardStrip({ expeditions, score, flashColour }: BoardStripProps) {
  return (
    <div className="board-strip">
      <ul className="board-strip__chips" role="list">
        {COLOURS.map((colour) => {
          const column = expeditions[colour];
          const top = topOf(column);
          const wagers = wagersIn(column);
          const started = column.length > 0;

          return (
            <li
              key={colour}
              data-zone={colour}
              className={`chip${started ? ' is-started' : ''}${
                flashColour === colour ? ' is-flashing' : ''
              }`}
              style={{ '--colour': `var(--colour-${colour})` } as React.CSSProperties}
            >
              <span className="chip__mark" aria-hidden="true">
                {COLOUR_MARK[colour]}
              </span>
              <span className="chip__value">{top ?? '–'}</span>
              {wagers > 0 && <span className="chip__wagers">×{wagers + 1}</span>}
              <span className="sr-only">
                {started
                  ? `${colour} at ${top ?? 'wagers only'}${wagers > 0 ? `, ${wagers} wagers` : ''}`
                  : `${colour} not started`}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="board-strip__score">
        <span className="sr-only">Round score </span>
        {score}
      </p>
    </div>
  );
}
