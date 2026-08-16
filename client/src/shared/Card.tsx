// ============================================================
// The one card visual, shared by table and phone.
//
// Pure: colour and value in, markup out. It knows nothing about hands,
// columns, discard piles, or connection state. The M9 art swap replaces
// the background inside this file and nowhere else.
// ============================================================

import { Card as CardModel, Colour } from '@shared/types';

export type CardSize = 'sm' | 'md' | 'lg';

/**
 * A non-colour channel for every card, per the accessibility floor:
 * colour is never the only thing distinguishing an expedition.
 */
export const COLOUR_MARK: Record<Colour, string> = {
  yellow: '▲',
  blue: '≈',
  white: '◆',
  green: '❋',
  red: '⬢',
};

export interface CardProps {
  card: CardModel;
  size?: CardSize;
  /** Greyed and non-interactive — an illegal target, not a missing one. */
  dimmed?: boolean;
  selected?: boolean;
  /** Explains a dim state to the player, e.g. "must beat 7". */
  title?: string;
  /**
   * The event is passed through for one reason: `detail === 0` distinguishes
   * a keyboard-synthesised click from a pointer one. In the fanned hand the
   * pointer path commits on `pointerup`, so the click has to be ignored
   * there — but Enter and Space never produce a pointer event and must
   * still work.
   */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export function Card({
  card,
  size = 'md',
  dimmed = false,
  selected = false,
  title,
  onClick,
}: CardProps) {
  const interactive = Boolean(onClick) && !dimmed;
  const label = card.value === 'wager' ? `${card.colour} wager` : `${card.colour} ${card.value}`;

  const className = [
    'card',
    `card--${size}`,
    `card--${card.colour}`,
    card.value === 'wager' && 'card--wager',
    dimmed && 'is-dimmed',
    selected && 'is-selected',
  ]
    .filter(Boolean)
    .join(' ');

  const face = (
    <>
      {/* The illustrated background plate and the suit-tinted Card_Overlay —
          both picked by `card--${colour}` / `card--wager` in app.css. Behind
          the text spans below by document order alone, the same trick this
          file already relies on for card__index. No card__mark here any
          more: the illustration itself is now the non-colour cue, so the
          glyph stayed only on CardSlot (no art of its own to carry it). */}
      <span className="card__art" aria-hidden="true" />
      <span className="card__overlay" aria-hidden="true" />
      {/* A corner index, the way a real card carries one. Hidden by default —
          app.css shows it only where the centred numeral below can't
          survive: a column card buried under the one played after it,
          reduced to a sliver too thin for anything else (columnMetrics.ts). */}
      <span className="card__index" aria-hidden="true">
        {card.value === 'wager' ? '✦' : card.value}
      </span>
      <span className="card__value">{card.value === 'wager' ? '✦' : card.value}</span>
    </>
  );

  // A card with nowhere to send a click is not a form control — it is a
  // picture of a card that a pointer gesture elsewhere (Hand's own
  // pointerdown, the table's reach) picks up by hit-testing the DOM, never
  // by receiving focus or a click. A <button disabled> here bought nothing
  // and cost the one thing every card in the app is today: dimmed hand
  // cards, table columns, discard piles — all of it renders through this
  // branch, since nothing in this codebase currently passes onClick.
  if (!interactive) {
    return (
      <div
        className={className}
        style={{ '--colour': `var(--colour-${card.colour})` } as React.CSSProperties}
        aria-label={label}
        title={title ?? label}
        // undefined, not false: a table card is not a toggle, and `false`
        // would announce it as an unpressed one. Carried on the div branch
        // too — selection state is orthogonal to whether this render has an
        // onClick to fire, e.g. a carried phone card is selected and has
        // nowhere to send a click at the same time.
        aria-pressed={selected ? true : undefined}
      >
        {face}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={className}
      style={{ '--colour': `var(--colour-${card.colour})` } as React.CSSProperties}
      aria-label={label}
      title={title ?? label}
      // undefined, not false: a table card is not a toggle, and `false`
      // would announce it as an unpressed one.
      aria-pressed={selected ? true : undefined}
      onClick={onClick}
    >
      {face}
    </button>
  );
}

/** An empty slot: a discard pile with nothing in it, or an unstarted column. */
export function CardSlot({
  colour,
  size = 'md',
  label,
}: {
  colour: Colour;
  size?: CardSize;
  label?: string;
}) {
  return (
    <div
      className={`card card--slot card--${size}`}
      style={{ '--colour': `var(--colour-${colour})` } as React.CSSProperties}
      aria-label={label ?? `${colour} empty`}
    >
      <span className="card__mark" aria-hidden="true">
        {COLOUR_MARK[colour]}
      </span>
    </div>
  );
}
