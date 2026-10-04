// How many cards sit in each row of the portrait hand.
//
// Pure, the way columnMetrics and fanLayout are: this is a decision about
// shape, checkable with numbers alone. The hand wraps rather than staying a
// single row, because a single row of 8 across a 390px-wide phone gives
// ~42px cards — unreadable. Portrait has the vertical room a landscape phone
// never did, so two balanced rows read instead of one cramped one.

/**
 * Cards in the first row; the rest follow in a second. Balanced rather than
 * front-loaded — a hand of 7 is 4-then-3, not 8-then-(-1) clamped to 7.
 *
 * A single row up to 4 cards, matching a hand played most of the way down —
 * the game already gets big cards for a short hand, and a lone row is worth
 * keeping for that case rather than wrapping two cards onto a mostly-empty
 * second row.
 */
export function perRow(count: number): number {
  if (count <= 0) return 0;
  if (count <= 4) return count;
  return Math.ceil(count / 2);
}

/**
 * Where a card sits in the fan of its own row: its offset from the middle,
 * so a row of four runs -1.5, -0.5, 0.5, 1.5 and a lone card is 0. The CSS
 * turns and drops each card by this, which is what bows a row into an arc.
 * The second row is fanned on its own, around its own middle.
 */
export function fanOffset(index: number, count: number): number {
  const first = perRow(count);
  const inFirst = index < first;
  const rowSize = inFirst ? first : count - first;
  const position = inFirst ? index : index - first;
  return position - (rowSize - 1) / 2;
}
