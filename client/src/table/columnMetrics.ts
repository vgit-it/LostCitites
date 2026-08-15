// How tall a card is on the table, and how much of the one behind it shows.
//
// Pure — no DOM, no measurement. Everything here is a *fraction of the side's
// own height*, which is what lets the CSS resolve it against container query
// units (100cqh) instead of a ResizeObserver, the same way the phone's fan
// trades spread against card width without measuring anything.
//
// The bug this exists to kill: card size and overlap used to be constants
// (4.5rem wide, -4.2rem overlap), so a column's height was a function of its
// card count alone and nothing tied it to the space available. A 3-card
// column came out 190px tall in a 128px band, overflowed its row, and — being
// position: relative and therefore painted above the static header and
// footer — wrote itself over the scores and the turn text.

/**
 * How much of each stacked card shows, as a fraction of a card's height.
 * Enough for the numeral in the corner and a band of colour.
 */
const SHOW = 0.38;

/**
 * A card never shrinks below this fraction of the side's height. Past here
 * the numeral stops being readable from across a table, and squeezing the
 * stack tighter is the better trade — which is what you would do with real
 * cards in a small space.
 */
const MIN_CARD = 0.42;

/** Nor does the gap between cards, or a long column becomes a smear. */
const MIN_SHOW = 0.12;

export interface ColumnMetrics {
  /** Card height, as a fraction of the side's height. */
  cardFraction: number;
  /** How much of each card behind shows, as a fraction of card height. */
  show: number;
}

/**
 * Metrics that fit `cards` into exactly one side-height.
 *
 * Two regimes. While the cards are big enough to read, the overlap is fixed
 * and the card shrinks. Once the card hits its floor, the card stays put and
 * the overlap tightens instead.
 */
export function columnMetrics(cards: number): ColumnMetrics {
  const n = Math.max(1, cards);
  if (n === 1) return { cardFraction: 1, show: SHOW };

  const ideal = 1 / (1 + (n - 1) * SHOW);
  if (ideal >= MIN_CARD) return { cardFraction: ideal, show: SHOW };

  // Solve the remaining space for the overlap rather than the card:
  // cardFraction + (n - 1) * cardFraction * show === 1.
  const show = (1 - MIN_CARD) / MIN_CARD / (n - 1);
  return { cardFraction: MIN_CARD, show: Math.max(MIN_SHOW, show) };
}

/**
 * What a whole side uses: its longest column's metrics, so all five read at
 * one scale rather than each column picking its own.
 */
export function sideMetrics(counts: number[]): ColumnMetrics {
  return columnMetrics(counts.length === 0 ? 1 : Math.max(...counts));
}

/**
 * How tall a column comes out, as a fraction of the side.
 *
 * 1 means it fits exactly. Above 1 it is clipped — only reachable past a
 * 12-card column, which this game cannot deal (3 wagers plus 2..10).
 */
export function columnExtent(cards: number, metrics: ColumnMetrics): number {
  const n = Math.max(1, cards);
  return metrics.cardFraction * (1 + (n - 1) * metrics.show);
}
