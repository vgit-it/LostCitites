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

/**
 * How a card lies on the table: a small tilt and nudge, so a played card
 * looks dropped rather than snapped to a grid. Derived from the card's id
 * alone (FNV-1a), so the same card always lies the same way — a re-render
 * or a reconnect never makes it jiggle. Only the table's CSS reads these.
 */
export function cardLie(id: string): { tilt: number; nudgeX: number; nudgeY: number } {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Three independent bytes of the hash, each mapped to [-1, 1].
  const unit = (shift: number) => (((h >>> shift) & 0xff) / 255) * 2 - 1;
  return { tilt: unit(0) * 1.8, nudgeX: unit(8) * 2, nudgeY: unit(16) * 2 };
}

function faceStyle(card: CardModel): React.CSSProperties {
  const lie = cardLie(card.id);
  return {
    '--colour': `var(--colour-${card.colour})`,
    '--tilt': `${lie.tilt.toFixed(2)}deg`,
    '--nudge-x': `${lie.nudgeX.toFixed(1)}px`,
    '--nudge-y': `${lie.nudgeY.toFixed(1)}px`,
  } as React.CSSProperties;
}

/** What each expedition is called on the card's face. */
export const SUIT_NAME: Record<Colour, string> = {
  yellow: 'The Desert',
  blue: 'The Deep',
  white: 'The Summit',
  green: 'The Canopy',
  red: 'The Volcano',
};

/** The rungs of the ascent ladder, foot to head. */
const LADDER = [2, 3, 4, 5, 6, 7, 8, 9, 10];

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

  const wager = card.value === 'wager';
  const shown = wager ? '✦' : card.value;

  // The Field Journal face: an engraved expedition plate filling the card
  // inside a double rule, with an ascent ladder down its left edge. Every
  // piece is placed by app.css; document order alone stacks them.
  const face = (
    <>
      <span className="card__art" aria-hidden="true" />
      <span className="card__frame" aria-hidden="true" />
      {/* The ascent ladder: 2 at the foot, 10 at the head, this card's
          value lit. It is the strip a fanned hand leaves showing, and it
          says at a glance how far up its expedition a card sits. A wager
          has no rung, so its ladder is bare. */}
      <span className="card__ladder" aria-hidden="true">
        {!wager &&
          LADDER.map((rung) => (
            <span key={rung} className={rung === card.value ? 'card__rung is-on' : 'card__rung'}>
              {rung}
            </span>
          ))}
      </span>
      {/* Corner cartouches, the way a real card carries its index: top-left,
          and the same again turned 180deg at bottom-right. The top-left one
          is what survives an overlap — a fanned hand, or a column card
          buried under the next one (columnMetrics.ts). The turned one is
          what the far seat reads on a shared discard pile. */}
      <span className="card__index" aria-hidden="true">
        {shown}
      </span>
      <span className="card__index card__index--foot" aria-hidden="true">
        {shown}
      </span>
      <span className="card__centre">
        <span className="card__value">{shown}</span>
        <span className="card__name" aria-hidden="true">
          {wager ? 'Wager' : SUIT_NAME[card.colour]}
        </span>
      </span>
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
        style={faceStyle(card)}
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
      style={faceStyle(card)}
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
