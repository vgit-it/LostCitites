// @vitest-environment jsdom
//
// Leaf components, rendered from fixture props. No provider, no socket,
// no mocking — which is the point of keeping them presentational.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Card as CardModel, Colour, PublicPlayerView } from '@shared/types';
import { Card } from './shared/Card';
import { Column } from './table/Column';
import { profilePoints } from './table/ElevationProfile';
import { DiscardRow, deckUrgency } from './table/DiscardRow';
import { PlayerBreakdown } from './table/RoundEnd';
import { Hand, drawnCardId, sortHand } from './phone/Hand';
import { SPREAD_MAX, SPREAD_MIN, fanLayout, fanSpan, slotTransform } from './phone/fan';
import {
  HOLD_MS,
  MOVE_SLOP_PX,
  chooseDrop,
  gestureReducer,
  initialGesture,
} from './phone/gesture';
import { DropZones, expeditionLabel } from './phone/DropZones';
import { CardFlight } from './phone/CardFlight';
import { DrawTargets } from './phone/DrawTargets';
import { PlaceActions, expeditionHint, placementWeight } from './phone/PlaceActions';
import { BoardStrip, topOf, wagersIn } from './phone/BoardStrip';
import { Tray } from './phone/Tray';
import {
  canVibrate,
  resetVibrateThrottle,
  vibrateCommit,
  vibrateReject,
  vibrateTick,
} from './platform/vibrate';
import { FLIGHT_MS, animate } from './platform/motion';

afterEach(cleanup);

type PointHitTest = (x: number, y: number) => Element | null;

/**
 * jsdom does not define document.elementFromPoint, so it cannot be spied on
 * — it has to be installed. Removed again after each test.
 */
function stubElementFromPoint(fn: PointHitTest): void {
  (document as unknown as { elementFromPoint?: PointHitTest }).elementFromPoint = fn;
}

afterEach(() => {
  delete (document as unknown as { elementFromPoint?: PointHitTest }).elementFromPoint;
});

const num = (colour: Colour, v: number): CardModel => ({
  id: `${colour}-${v}`,
  colour,
  value: v as CardModel['value'],
});
const wager = (colour: Colour, n: number): CardModel => ({
  id: `${colour}-w${n}`,
  colour,
  value: 'wager',
});

const noTops: Record<Colour, CardModel | null> = {
  yellow: null,
  blue: null,
  white: null,
  green: null,
  red: null,
};

describe('Card', () => {
  it('always shows its number — colour is never the only channel', () => {
    render(<Card card={num('blue', 7)} />);
    expect(screen.getByLabelText('blue 7').textContent).toContain('7');
  });

  it('marks a wager distinctly from a number', () => {
    render(<Card card={wager('red', 1)} />);
    expect(screen.getByLabelText('red wager').className).toContain('card--wager');
  });

  it('does not fire onClick while dimmed', () => {
    const onClick = vi.fn();
    render(<Card card={num('green', 4)} dimmed onClick={onClick} />);
    fireEvent.click(screen.getByLabelText('green 4'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('carries a corner index alongside the big numeral', () => {
    // Both are in the DOM on every card; CSS shows the index only inside a
    // fan. Note this means a numeral matches twice — use getAllByText.
    const { container } = render(<Card card={num('blue', 7)} />);
    expect(container.querySelector('.card__index')?.textContent).toBe('7');
    expect(container.querySelector('.card__value')?.textContent).toBe('7');
  });

  it('announces toggle state only when it is actually selectable', () => {
    // A table card is not a toggle; aria-pressed="false" would claim it is.
    const { container: plain } = render(<Card card={num('blue', 7)} />);
    expect(plain.querySelector('.card')?.hasAttribute('aria-pressed')).toBe(false);

    const { container: picked } = render(<Card card={num('blue', 8)} selected />);
    expect(picked.querySelector('.card')?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Column', () => {
  it('renders an empty slot for an unstarted colour', () => {
    render(<Column colour="white" cards={[]} direction="down" />);
    expect(screen.getByLabelText('white not started')).toBeTruthy();
  });

  it('renders every card in the column', () => {
    render(
      <Column colour="blue" cards={[wager('blue', 1), num('blue', 4), num('blue', 9)]} direction="down" />,
    );
    expect(screen.getByLabelText('blue wager')).toBeTruthy();
    expect(screen.getByLabelText('blue 4')).toBeTruthy();
    expect(screen.getByLabelText('blue 9')).toBeTruthy();
  });
});

describe('deck urgency', () => {
  it('turns amber below 10 and red below 5', () => {
    expect(deckUrgency(44)).toBe('normal');
    expect(deckUrgency(10)).toBe('normal');
    expect(deckUrgency(9)).toBe('low');
    expect(deckUrgency(5)).toBe('low');
    expect(deckUrgency(4)).toBe('critical');
    expect(deckUrgency(0)).toBe('critical');
  });

  it('always shows the draw pile count', () => {
    render(<DiscardRow deckCount={44} discardTops={noTops} />);
    expect(screen.getByText('44')).toBeTruthy();
  });
});

describe('hand ordering', () => {
  it('sorts by colour then value, wagers leading their colour', () => {
    const sorted = sortHand([
      num('blue', 9),
      num('yellow', 3),
      wager('blue', 1),
      num('blue', 2),
      num('yellow', 10),
    ]);
    expect(sorted.map((c) => c.id)).toEqual([
      'yellow-3',
      'yellow-10',
      'blue-w1',
      'blue-2',
      'blue-9',
    ]);
  });

  it('mutes a card with no legal target but still lets you ask why', () => {
    // Changed by design: an unplayable card used to be `disabled`, so there
    // was no way to find out why it could not be played. It is now selectable
    // and the tray answers with expeditionHint().
    const onSelect = vi.fn();
    const { container } = render(
      <Hand
        cards={[num('blue', 2), num('red', 5)]}
        legalPlacements={{ 'blue-2': ['discard'] }}
        selectedId={null}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByLabelText('red 5'));
    expect(onSelect).toHaveBeenCalledWith('red-5');
    expect(container.querySelector('[data-card-id="red-5"]')?.className).toContain('is-muted');

    fireEvent.click(screen.getByLabelText('blue 2'));
    expect(onSelect).toHaveBeenCalledWith('blue-2');
    expect(container.querySelector('[data-card-id="blue-2"]')?.className).not.toContain('is-muted');
  });

  it('stops marking cards unplayable once there is no placement to make', () => {
    // The server sends no legalPlacements during the draw phase, so reading
    // it then would grey out the entire hand — and the hand's colours are
    // exactly what decides which discard is worth taking.
    const { container } = render(
      <Hand cards={[num('blue', 2)]} legalPlacements={{}} selectedId={null} onSelect={vi.fn()} muted />,
    );

    const list = container.querySelector('.hand--fan') as HTMLElement;
    expect(container.querySelector('[data-card-id="blue-2"]')?.className).not.toContain('is-muted');
    expect(list.className).toContain('is-muted'); // inert...
    expect(list.className).not.toContain('is-away'); // ...but not receded
  });

  it('ignores a pointer-driven click, because the scrub already handled it', () => {
    // A press and release across two cards fires click on their common
    // ancestor, so click cannot be trusted for pointers. detail tells them
    // apart: 0 is a keyboard activation, >= 1 came from a pointer.
    const onSelect = vi.fn();
    render(
      <Hand
        cards={[num('blue', 2)]}
        legalPlacements={{ 'blue-2': ['discard'] }}
        selectedId={null}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByLabelText('blue 2'), { detail: 1 });
    expect(onSelect).not.toHaveBeenCalled();

    // Enter and Space synthesise a click with no pointer behind it.
    fireEvent.click(screen.getByLabelText('blue 2'), { detail: 0 });
    expect(onSelect).toHaveBeenCalledWith('blue-2');
  });

  it('raises the card under a press, so a plain tap still feels immediate', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <Hand
        cards={[num('blue', 2), num('blue', 5)]}
        legalPlacements={{ 'blue-2': ['discard'], 'blue-5': ['discard'] }}
        selectedId={null}
        onSelect={onSelect}
      />,
    );

    const list = container.querySelector('.hand--fan') as HTMLElement;
    // jsdom implements no layout and does not define elementFromPoint at
    // all, so stand in for the hit test a browser would do.
    stubElementFromPoint(() => container.querySelector('[data-card-id="blue-5"]'));

    fireEvent.pointerDown(list, { clientX: 10, clientY: 10, button: 0 });
    expect(onSelect).toHaveBeenCalledWith('blue-5');
  });

  it('fans the hand rather than choosing, once the thumb travels', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <Hand
        cards={[num('blue', 2), num('blue', 5)]}
        legalPlacements={{ 'blue-2': ['discard'], 'blue-5': ['discard'] }}
        selectedId="blue-2"
        onSelect={onSelect}
      />,
    );

    const list = container.querySelector('.hand--fan') as HTMLElement;
    stubElementFromPoint(() => container.querySelector('[data-card-id="blue-2"]'));
    const before = list.style.getPropertyValue('--fan-span');

    fireEvent.pointerDown(list, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(list, { clientX: 10 + MOVE_SLOP_PX + 80, clientY: 12 });

    expect(list.className).toContain('is-fanning');
    // The geometry actually moved under the thumb.
    expect(list.style.getPropertyValue('--fan-span')).not.toBe(before);
    // And fanning is not choosing: the raise from the press is withdrawn.
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('picks a card up when the press is held still', () => {
    vi.useFakeTimers();
    try {
      const onLift = vi.fn();
      const { container } = render(
        <Hand
          cards={[num('blue', 2)]}
          legalPlacements={{ 'blue-2': ['discard'] }}
          selectedId={null}
          onSelect={vi.fn()}
          onLift={onLift}
        />,
      );

      const list = container.querySelector('.hand--fan') as HTMLElement;
      stubElementFromPoint(() => container.querySelector('[data-card-id="blue-2"]'));

      fireEvent.pointerDown(list, { clientX: 10, clientY: 10, button: 0 });
      act(() => void vi.advanceTimersByTime(HOLD_MS));

      expect(onLift).toHaveBeenCalledWith('blue-2');
      expect(container.querySelector('[data-card-id="blue-2"]')?.className).toContain(
        'is-dragging',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not pick a card up if the thumb moved first', () => {
    vi.useFakeTimers();
    try {
      const onLift = vi.fn();
      const { container } = render(
        <Hand
          cards={[num('blue', 2)]}
          legalPlacements={{ 'blue-2': ['discard'] }}
          selectedId={null}
          onSelect={vi.fn()}
          onLift={onLift}
        />,
      );

      const list = container.querySelector('.hand--fan') as HTMLElement;
      stubElementFromPoint(() => container.querySelector('[data-card-id="blue-2"]'));

      fireEvent.pointerDown(list, { clientX: 10, clientY: 10, button: 0 });
      fireEvent.pointerMove(list, { clientX: 10 + MOVE_SLOP_PX + 30, clientY: 10 });
      act(() => void vi.advanceTimersByTime(HOLD_MS * 4));

      expect(onLift).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports where a held card was let go, and says so when it was cancelled', () => {
    vi.useFakeTimers();
    try {
      const onRelease = vi.fn();
      const { container } = render(
        <Hand
          cards={[num('blue', 2)]}
          legalPlacements={{ 'blue-2': ['discard'] }}
          selectedId={null}
          onSelect={vi.fn()}
          onRelease={onRelease}
        />,
      );

      const list = container.querySelector('.hand--fan') as HTMLElement;
      stubElementFromPoint(() => container.querySelector('[data-card-id="blue-2"]'));

      const lift = () => {
        fireEvent.pointerDown(list, { clientX: 10, clientY: 10, button: 0 });
        act(() => void vi.advanceTimersByTime(HOLD_MS));
      };

      lift();
      fireEvent.pointerUp(list, { clientX: 120, clientY: 40 });
      expect(onRelease).toHaveBeenLastCalledWith('blue-2', { x: 120, y: 40 });

      lift();
      fireEvent.pointerCancel(list, { clientX: 120, clientY: 40 });
      expect(onRelease).toHaveBeenLastCalledWith('blue-2', null);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores movement when no gesture is running', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <Hand
        cards={[num('blue', 2)]}
        legalPlacements={{ 'blue-2': ['discard'] }}
        selectedId={null}
        onSelect={onSelect}
      />,
    );

    const list = container.querySelector('.hand--fan') as HTMLElement;
    stubElementFromPoint(() => container.querySelector('[data-card-id="blue-2"]'));

    fireEvent.pointerUp(list, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(list, { clientX: 90, clientY: 10 });

    expect(onSelect).not.toHaveBeenCalled();
    expect(list.className).not.toContain('is-fanning');
  });

  it('is genuinely inert when the turn is not this phone to act on', () => {
    const onSelect = vi.fn();
    render(
      <Hand
        cards={[num('blue', 2)]}
        legalPlacements={{ 'blue-2': ['discard'] }}
        selectedId={null}
        onSelect={onSelect}
        disabled
      />,
    );

    fireEvent.click(screen.getByLabelText('blue 2'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('fan layout', () => {
  it('has nothing to place for an empty hand', () => {
    expect(fanLayout(0)).toEqual([]);
  });

  it('leaves a single card square to the eye', () => {
    expect(fanLayout(1)).toEqual([
      { transform: 'translate(0.00%, 0.00%) rotate(0.00deg)', tx: 0, ty: 0, angle: 0, zIndex: 0 },
    ]);
  });

  it('is symmetric about the middle of the hand', () => {
    const slots = fanLayout(8);
    for (let i = 0; i < slots.length; i += 1) {
      expect(slots[i].angle).toBeCloseTo(-slots[slots.length - 1 - i].angle, 10);
    }
  });

  it('runs left to right with the middle of the hand highest', () => {
    const slots = fanLayout(8);
    for (let i = 1; i < slots.length; i += 1) {
      expect(slots[i].tx).toBeGreaterThan(slots[i - 1].tx);
    }
    // ty grows downward, so the centre cards carry the smallest values.
    const centre = Math.min(...slots.map((s) => s.ty));
    expect(slots[3].ty).toBeCloseTo(centre, 10);
    expect(slots[0].ty).toBeGreaterThan(centre);
  });

  it('caps the total spread so a big hand never curls into a claw', () => {
    const slots = fanLayout(20);
    const spread = slots[slots.length - 1].angle - slots[0].angle;
    expect(spread).toBeCloseTo(34, 10);
  });

  it('places a full hand exactly', () => {
    expect(fanLayout(8).map((s) => s.transform)).toEqual([
      'translate(-138.24%, 12.75%) rotate(-15.75deg)',
      'translate(-99.36%, 6.52%) rotate(-11.25deg)',
      'translate(-59.86%, 2.35%) rotate(-6.75deg)',
      'translate(-19.99%, 0.26%) rotate(-2.25deg)',
      'translate(19.99%, 0.26%) rotate(2.25deg)',
      'translate(59.86%, 2.35%) rotate(6.75deg)',
      'translate(99.36%, 6.52%) rotate(11.25deg)',
      'translate(138.24%, 12.75%) rotate(15.75deg)',
    ]);
  });

  it('keeps a full hand inside a narrow phone', () => {
    // The load-bearing sum: the fan spans (tx range + one card). At
    // --fan-card-w: min(5.5rem, 24vw) that is ~325px of a 360px screen, so
    // it fits without the container ever needing to clip — which matters,
    // because nothing in the app sets overflow and a clipped fan would be
    // sheared rather than scrolled.
    const slots = fanLayout(8);
    const spanInCardWidths = (slots[7].tx - slots[0].tx) / 100 + 1;
    expect(spanInCardWidths).toBeLessThan(3.9);
    expect(spanInCardWidths * 0.24 * 100).toBeLessThan(92); // vw at 24vw cards
  });

  it('opens and closes with the spread, and rests at the shape it always had', () => {
    const closed = fanLayout(8, SPREAD_MIN);
    const rest = fanLayout(8);
    const open = fanLayout(8, SPREAD_MAX);

    // Both the tilt and the gap between neighbours move — tilt alone would
    // rotate the cards without separating them, since the arc radius falls
    // as the step grows and holds the spacing constant.
    for (const [tighter, wider] of [
      [closed, rest],
      [rest, open],
    ] as const) {
      expect(Math.abs(wider[0].angle)).toBeGreaterThan(Math.abs(tighter[0].angle));
      expect(Math.abs(wider[0].tx)).toBeGreaterThan(Math.abs(tighter[0].tx));
    }
  });

  it('reports a span the card size can be divided by, at every spread', () => {
    // The contract with .hand--fan: --fan-card-w is (viewport / span), so a
    // wider fan yields smaller cards rather than cards that overflow a box
    // nothing in the app is allowed to clip.
    expect(fanSpan(0)).toBe(1);
    expect(fanSpan(1)).toBe(1);
    // Centre-to-centre plus the outer cards' *rotated* bounding boxes, not
    // plus one card width — the tilt is what made the fan overflow a 390px
    // viewport by 6px on each side.
    expect(fanSpan(8)).toBeCloseTo(4.1345, 3);
    expect(fanSpan(8, SPREAD_MAX)).toBeGreaterThan(fanSpan(8, SPREAD_MIN));

    // Even thrown fully open, a full hand stays inside a narrow phone once
    // the span has been paid for in card width.
    const widest = fanSpan(8, SPREAD_MAX);
    expect((360 - 24) / widest).toBeGreaterThan(56); // px per card, still legible
  });

  it('lifts a card clear of the fan and levels it', () => {
    const slot = fanLayout(8)[0];
    expect(slotTransform(slot, 'lifted')).toBe(
      'translate(-138.24%, -21.00%) rotate(0.00deg) scale(1.06)',
    );
  });

  it('sits an unplayable card back without disturbing its tilt', () => {
    const slot = fanLayout(8)[0];
    expect(slotTransform(slot, 'muted')).toBe('translate(-138.24%, 16.75%) rotate(-15.75deg)');
    expect(slotTransform(slot, 'rest')).toBe(slot.transform);
  });
});

describe('place actions', () => {
  it('names the destination rather than saying "confirm"', () => {
    render(
      <PlaceActions
        card={num('blue', 7)}
        targets={['expedition', 'discard']}
        column={[]}
        onPlace={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /play to blue/i })).toBeTruthy();
  });

  it('disables the expedition button when the server did not offer it', () => {
    render(
      <PlaceActions
        card={num('blue', 4)}
        targets={['discard']}
        column={[num('blue', 7)]}
        onPlace={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /play to blue/i }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('treats starting a column as the one irreversible commitment', () => {
    expect(placementWeight([], num('blue', 7))).toBe('commits');
    // A wager cannot start a column's scoring on its own.
    expect(placementWeight([], wager('blue', 1))).toBe('normal');
    expect(placementWeight([num('blue', 3)], num('blue', 7))).toBe('normal');
  });

  it('asks twice before starting a column, and discloses the cost', () => {
    const onPlace = vi.fn();
    render(
      <PlaceActions
        card={num('blue', 7)}
        targets={['expedition', 'discard']}
        column={[]}
        onPlace={onPlace}
      />,
    );

    const play = screen.getByRole('button', { name: /play to blue/i });
    expect(play.textContent).toContain('costs 20');

    fireEvent.click(play);
    expect(onPlace).not.toHaveBeenCalled();

    const armed = screen.getByRole('button', { name: /tap again to start blue/i });
    fireEvent.click(armed);
    expect(onPlace).toHaveBeenCalledWith('expedition');
  });

  it('plays a card into a started column on the first tap', () => {
    const onPlace = vi.fn();
    render(
      <PlaceActions
        card={num('blue', 9)}
        targets={['expedition', 'discard']}
        column={[num('blue', 3)]}
        onPlace={onPlace}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /play to blue/i }));
    expect(onPlace).toHaveBeenCalledWith('expedition');
  });

  it('disarms itself if the question goes unanswered', () => {
    vi.useFakeTimers();
    const onPlace = vi.fn();
    render(
      <PlaceActions
        card={num('blue', 7)}
        targets={['expedition', 'discard']}
        column={[]}
        onPlace={onPlace}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /play to blue/i }));
    expect(screen.getByRole('button', { name: /tap again/i })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByRole('button', { name: /costs 20/i })).toBeTruthy();
    expect(onPlace).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('explains why by reading the column back', () => {
    expect(expeditionHint([num('blue', 7)], num('blue', 4))).toBe('blue is at 7');
    expect(expeditionHint([], num('blue', 4))).toBe('Cannot start blue');
    expect(expeditionHint([num('blue', 7)], wager('blue', 1))).toContain('wagers must come first');
  });
});

describe('draw targets', () => {
  const tops = { ...noTops, blue: num('blue', 6), red: num('red', 3) };

  it('offers only the sources the server marked legal', () => {
    const onDraw = vi.fn();
    render(
      <DrawTargets
        deckCount={20}
        discardTops={tops}
        legalDrawSources={[{ kind: 'deck' }, { kind: 'discard', colour: 'blue' }]}
        blockedDrawCardId="red-3"
        onDraw={onDraw}
      />,
    );

    fireEvent.click(screen.getByLabelText('blue 6'));
    expect(onDraw).toHaveBeenCalledWith({ kind: 'discard', colour: 'blue' });

    // The card just discarded is locked.
    onDraw.mockClear();
    fireEvent.click(screen.getByLabelText('red 3'));
    expect(onDraw).not.toHaveBeenCalled();
  });

  it('disables the deck when it is not a legal source', () => {
    render(
      <DrawTargets
        deckCount={0}
        discardTops={tops}
        legalDrawSources={[{ kind: 'discard', colour: 'blue' }]}
        blockedDrawCardId={null}
        onDraw={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /deck/i }).hasAttribute('disabled')).toBe(true);
  });
});

describe('round-end breakdown', () => {
  function player(expeditions: Partial<Record<Colour, CardModel[]>>): PublicPlayerView {
    return {
      seat: 0,
      name: 'Paul',
      connected: true,
      handCount: 8,
      expeditions: { yellow: [], blue: [], white: [], green: [], red: [], ...expeditions },
      roundScores: [],
      currentRoundScore: 0,
    };
  }

  it('shows the arithmetic, not just the total', () => {
    render(
      <PlayerBreakdown
        player={player({ blue: [wager('blue', 1), num('blue', 2), num('blue', 5), num('blue', 9)] })}
      />,
    );

    expect(screen.getByText('2 + 5 + 9 = 16')).toBeTruthy();
    expect(screen.getByText('− 20 = -4')).toBeTruthy();
    expect(screen.getByText('× 2')).toBeTruthy();
    // Once as the blue column score, once as the round total — it is the only
    // column played, so the two agree.
    expect(screen.getAllByText('-8')).toHaveLength(2);
  });

  it('scores an untouched colour 0 rather than -20', () => {
    render(<PlayerBreakdown player={player({})} />);
    expect(screen.getAllByText('0')).toHaveLength(6); // five colours + total
  });

  it('shows the 8-card bonus after the multiplier', () => {
    render(
      <PlayerBreakdown
        player={player({
          white: [
            wager('white', 1),
            wager('white', 2),
            ...[2, 3, 4, 5, 6, 7].map((v) => num('white', v)),
          ],
        })}
      />,
    );
    expect(screen.getByText('× 3 + 20')).toBeTruthy();
    expect(screen.getAllByText('41')).toHaveLength(2); // column score and round total
  });
});

describe('elevation profile', () => {
  it('is not drawn for a stub of one card', () => {
    const { container } = render(
      <Column colour="blue" cards={[num('blue', 4)]} direction="down" />,
    );
    expect(container.querySelector('.elevation')).toBeNull();
  });

  it('rises with the values played', () => {
    // 2 is the lowest number, 10 the highest, so displacement runs 0 -> 1.
    const points = profilePoints([num('blue', 2), num('blue', 10)], 'down');
    expect(points).toBe('0.000,0.000 0.000,0.500 1.000,0.500 1.000,1.000');
  });

  it('puts wagers on the baseline', () => {
    expect(profilePoints([wager('red', 1), wager('red', 2)], 'down')).toBe(
      '0.000,0.000 0.000,0.500 0.000,0.500 0.000,1.000',
    );
  });

  it('runs the other way for an upward column', () => {
    expect(profilePoints([num('blue', 2), num('blue', 10)], 'up')).toBe(
      '0.000,1.000 0.000,0.500 1.000,0.500 1.000,0.000',
    );
  });
});

describe('the gesture machine', () => {
  const down = { t: 'down', cardId: 'blue-2', x: 100, y: 300 } as const;

  it('holds a press pending until something tells it what the press was', () => {
    const state = gestureReducer(initialGesture, down);
    expect(state.phase).toBe('pending');
    expect(state.cardId).toBe('blue-2');
  });

  it('turns a press that travels into a fan, and moves the spread with it', () => {
    const pressed = gestureReducer(initialGesture, down);
    const fanned = gestureReducer(pressed, { t: 'move', x: 100 + MOVE_SLOP_PX + 60, y: 302 });

    expect(fanned.phase).toBe('fanning');
    expect(fanned.spread).toBeGreaterThan(pressed.spread);
  });

  it('does not fan on a movement too small to be one', () => {
    const pressed = gestureReducer(initialGesture, down);
    const nudged = gestureReducer(pressed, { t: 'move', x: 100 + MOVE_SLOP_PX - 1, y: 300 });

    expect(nudged.phase).toBe('pending');
    expect(nudged.spread).toBe(pressed.spread);
  });

  it('cancels the pickup on a vertical drag too — that is not a fan, but it is not still either', () => {
    const pressed = gestureReducer(initialGesture, down);
    const dragged = gestureReducer(pressed, { t: 'move', x: 100, y: 300 + MOVE_SLOP_PX + 40 });

    expect(dragged.phase).toBe('fanning');
    expect(gestureReducer(dragged, { t: 'hold' }).phase).toBe('fanning');
  });

  it('lifts on a hold, and only from a press that is still a press', () => {
    const pressed = gestureReducer(initialGesture, down);
    expect(gestureReducer(pressed, { t: 'hold' }).phase).toBe('lifted');

    // A press that landed on no card has nothing to pick up.
    const onNothing = gestureReducer(initialGesture, { ...down, cardId: null });
    expect(gestureReducer(onNothing, { t: 'hold' }).phase).toBe('pending');
  });

  it('carries a lifted card with the thumb', () => {
    const lifted = gestureReducer(gestureReducer(initialGesture, down), { t: 'hold' });
    const moved = gestureReducer(lifted, { t: 'move', x: 140, y: 180 });

    expect(moved.phase).toBe('lifted');
    expect(moved.drag).toEqual({ x: 40, y: -120 });
  });

  it('clamps the spread at both ends however far the thumb goes', () => {
    const pressed = gestureReducer(initialGesture, down);
    expect(gestureReducer(pressed, { t: 'move', x: 100000, y: 300 }).spread).toBe(SPREAD_MAX);
    expect(gestureReducer(pressed, { t: 'move', x: -100000, y: 300 }).spread).toBe(SPREAD_MIN);
  });

  it('keeps the spread across gestures — the hand holds the shape you left it in', () => {
    const fanned = gestureReducer(gestureReducer(initialGesture, down), {
      t: 'move',
      x: 100 + MOVE_SLOP_PX + 60,
      y: 300,
    });
    const settled = gestureReducer(fanned, { t: 'up' });

    expect(settled.phase).toBe('idle');
    expect(settled.spread).toBe(fanned.spread);
    expect(settled.drag).toEqual({ x: 0, y: 0 });
  });
});

describe('what a release meant', () => {
  it('places on a zone the server offered', () => {
    expect(chooseDrop('expedition', ['expedition', 'discard'])).toEqual({
      kind: 'place',
      target: 'expedition',
    });
  });

  it('refuses a zone it did not, rather than silently swallowing the drop', () => {
    expect(chooseDrop('expedition', ['discard'])).toEqual({
      kind: 'refuse',
      target: 'expedition',
    });
  });

  it('treats neutral space as the cancel gesture', () => {
    // The whole reason both commits could move to the top of the screen:
    // changing your mind is now "let go anywhere else" rather than a
    // downward flick, which freed the direction discard needed.
    expect(chooseDrop(null, ['expedition', 'discard'])).toEqual({ kind: 'cancel' });
  });
});

describe('drop zones', () => {
  const started = [num('blue', 3)];

  it('names the destination, and prices it when the column is unstarted', () => {
    expect(expeditionLabel(started, num('blue', 7))).toBe('Play to blue');
    expect(expeditionLabel([], num('blue', 7))).toBe('Start blue \u00b7 \u221220');
    // A wager onto an empty column is not the -20 commitment; the first
    // number is. placementWeight already draws that line.
    expect(expeditionLabel([], wager('blue', 1))).toBe('Play to blue');
  });

  it('reads the column back on a target the server did not offer', () => {
    const { container } = render(
      <DropZones
        card={num('blue', 2)}
        targets={['discard']}
        column={[num('blue', 9)]}
        hovered={null}
      />,
    );

    const expedition = container.querySelector('[data-drop="expedition"]') as HTMLElement;
    expect(expedition.className).toContain('is-dead');
    expect(expedition.textContent).toContain('blue is at 9');
    expect(
      (container.querySelector('[data-drop="discard"]') as HTMLElement).className,
    ).not.toContain('is-dead');
  });

  it('arms the zone the card is actually over', () => {
    const { container } = render(
      <DropZones
        card={num('blue', 7)}
        targets={['expedition', 'discard']}
        column={started}
        hovered="discard"
      />,
    );

    expect(
      (container.querySelector('[data-drop="expedition"]') as HTMLElement).className,
    ).not.toContain('is-over');
    expect((container.querySelector('[data-drop="discard"]') as HTMLElement).className).toContain(
      'is-over',
    );
  });

  it('stays out of the accessibility tree — the labelled route is PlaceActions', () => {
    const { container } = render(
      <DropZones
        card={num('blue', 7)}
        targets={['expedition', 'discard']}
        column={started}
        hovered={null}
      />,
    );

    expect(container.querySelector('.drop-zones')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('spotting a drawn card', () => {
  it('names the one card that arrived', () => {
    expect(drawnCardId([num('blue', 2)], [num('blue', 2), num('red', 9)])).toBe('red-9');
  });

  it('says nothing when the hand did not change', () => {
    const hand = [num('blue', 2), num('red', 9)];
    expect(drawnCardId(hand, hand)).toBeNull();
  });

  it('refuses to guess when several cards appear at once', () => {
    // The reconnect case: a fresh full view can differ arbitrarily, and a
    // diff-driven animator would answer it with a flurry of bogus flights.
    expect(drawnCardId([], [num('blue', 2), num('red', 9)])).toBeNull();
  });

  it('is not fooled by a reorder', () => {
    expect(
      drawnCardId([num('blue', 2), num('red', 9)], [num('red', 9), num('blue', 2)]),
    ).toBeNull();
  });

  it('says nothing when a card left instead of arriving', () => {
    expect(drawnCardId([num('blue', 2), num('red', 9)], [num('blue', 2)])).toBeNull();
  });
});

describe('card flight', () => {
  const rect = (x: number, y: number, w = 88) => ({ x, y, width: w, height: w * 1.5 });

  it('finishes even where WAAPI does not exist, so the overlay clears', () => {
    // jsdom has no Element.animate. If onDone did not fire, the clone would
    // sit on top of the real UI forever.
    const onDone = vi.fn();
    render(<CardFlight card={num('blue', 7)} from={rect(0, 0)} to={rect(200, 40, 30)} onDone={onDone} />);
    return vi.waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('starts at the source and stays out of the way', () => {
    const { container } = render(
      <CardFlight card={num('blue', 7)} from={rect(12, 300)} to={rect(200, 40, 30)} onDone={vi.fn()} />,
    );
    const el = container.querySelector('.card-flight') as HTMLElement;

    expect(el.style.left).toBe('12px');
    expect(el.style.top).toBe('300px');
    // It is a picture of a card; the real one is elsewhere.
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('board strip', () => {
  const empty = (): Record<Colour, CardModel[]> => ({
    yellow: [],
    blue: [],
    white: [],
    green: [],
    red: [],
  });

  it('reads a column back by its highest number', () => {
    expect(topOf([])).toBeNull();
    expect(topOf([num('blue', 3), num('blue', 7)])).toBe(7);
    // A column of wagers alone has no number to show yet.
    expect(topOf([wager('blue', 1)])).toBeNull();
  });

  it('counts wagers as the multiplier they are', () => {
    expect(wagersIn([])).toBe(0);
    expect(wagersIn([wager('red', 1), wager('red', 2), num('red', 4)])).toBe(2);
  });

  it('distinguishes an unstarted column from a started one', () => {
    const expeditions = empty();
    expeditions.blue = [num('blue', 7)];
    const { container } = render(<BoardStrip expeditions={expeditions} score={12} />);

    expect(container.querySelector('[data-zone="blue"]')?.className).toContain('is-started');
    expect(container.querySelector('[data-zone="red"]')?.className).not.toContain('is-started');
  });

  it('shows the live score the server sent, and every colour as a target', () => {
    const { container } = render(<BoardStrip expeditions={empty()} score={-13} />);

    expect(container.querySelector('.board-strip__score')?.textContent).toContain('-13');
    // Each chip is a flight destination, addressable by colour.
    for (const colour of ['yellow', 'blue', 'white', 'green', 'red']) {
      expect(container.querySelector(`[data-zone="${colour}"]`)).toBeTruthy();
    }
  });
});

describe('tray', () => {
  it('remounts its contents on a mode change so the enter animation runs', () => {
    const { container, rerender } = render(
      <Tray mode="table">
        <p>board</p>
      </Tray>,
    );
    const first = container.querySelector('.tray__inner');

    rerender(
      <Tray mode="place">
        <p>place</p>
      </Tray>,
    );

    expect(container.querySelector('.tray')?.className).toContain('tray--place');
    expect(container.querySelector('.tray__inner')).not.toBe(first);
  });
});

describe('haptics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetVibrateThrottle();
  });

  it('is silent where the device has no motor', () => {
    vi.stubGlobal('navigator', {});
    expect(canVibrate()).toBe(false);
    expect(() => vibrateTick()).not.toThrow();
  });

  it('throttles scrub ticks so sliding a thumb cannot machine-gun the motor', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });

    vibrateTick();
    vibrateTick();
    vibrateTick();

    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('does not throttle the deliberate one-off haptics', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });

    vibrateCommit();
    vibrateReject();

    expect(vibrate).toHaveBeenNthCalledWith(1, [12, 40, 18]);
    expect(vibrate).toHaveBeenNthCalledWith(2, [30, 60, 30]);
  });

  it('survives an engine that exposes vibrate and then refuses it', () => {
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('needs a user gesture');
      },
    });
    expect(() => vibrateCommit()).not.toThrow();
  });
});

describe('motion', () => {
  it('resolves instead of throwing where WAAPI is missing', async () => {
    // jsdom has no Element.animate. Every flight in the app awaits this, so
    // an unguarded call would hang the component, not just skip the motion.
    const el = document.createElement('div');
    await expect(animate(el, [{ opacity: 0 }], { duration: 200 })).resolves.toBeUndefined();
  });

  it('resolves when the animation is cancelled mid-flight', async () => {
    // The real case: the server's next `state` unmounts the card while it flies.
    const el = document.createElement('div');
    (el as unknown as { animate: unknown }).animate = () => ({
      finished: Promise.reject(new Error('cancelled')),
    });
    await expect(animate(el, [{ opacity: 0 }], { duration: 200 })).resolves.toBeUndefined();
  });

  it('collapses the duration under reduced motion', async () => {
    const spy = vi.fn(() => ({ finished: Promise.resolve() }));
    const el = document.createElement('div');
    (el as unknown as { animate: unknown }).animate = spy;
    vi.stubGlobal('matchMedia', () => ({ matches: true }));

    await animate(el, [{ opacity: 0 }], { duration: FLIGHT_MS });

    expect(spy).toHaveBeenCalledWith([{ opacity: 0 }], { duration: 0 });
    vi.unstubAllGlobals();
  });
});
