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
    card.value === 'wager' && 'card--wager',
    dimmed && 'is-dimmed',
    selected && 'is-selected',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={className}
      style={{ '--colour': `var(--colour-${card.colour})` } as React.CSSProperties}
      disabled={!interactive}
      aria-label={label}
      title={title ?? label}
      // undefined, not false: a table card is not a toggle, and `false`
      // would announce it as an unpressed one.
      aria-pressed={selected ? true : undefined}
      onClick={interactive ? onClick : undefined}
    >
      <span className="card__mark" aria-hidden="true">
        {COLOUR_MARK[card.colour]}
      </span>
      {/* A corner index, the way a real card carries one. Hidden until a
          fanned hand overlaps the faces and the centred numeral is buried
          on every card but the last. */}
      <span className="card__index" aria-hidden="true">
        {card.value === 'wager' ? '✦' : card.value}
      </span>
      <span className="card__value">{card.value === 'wager' ? '✦' : card.value}</span>
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
