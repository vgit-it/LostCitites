// @vitest-environment jsdom
//
// Leaf components, rendered from fixture props. No provider, no socket,
// no mocking — which is the point of keeping them presentational.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Card as CardModel, Colour, PlayerView, PublicPlayerView, TableView } from '@shared/types';
import { Card } from './shared/Card';
import { Column } from './table/Column';
import { profilePoints } from './table/ElevationProfile';
import { DiscardRow, deckUrgency } from './table/DiscardRow';
import { PlayerBreakdown } from './table/RoundEnd';
import { Hand, drawnCardId, sortHand } from './phone/Hand';
import { perRow } from './phone/handRows';
import {
  FLICK_V,
  MAX_TILT_DEG,
  followStep,
  isSettled,
  tiltFor,
  trimSamples,
  velocityFrom,
} from './shared/carry';
import { ARM_DX, THROW_DX, armedSide, flickOutcome } from './phone/throw';
import { REACH_PX, reachOutcome, towardSeat } from './table/drawGesture';
import { dragOf, gestureReducer, initialGesture } from './phone/gesture';
import { FlickZones } from './phone/FlickZones';
import { HandActions } from './phone/HandActions';
import { expeditionHint, placementWeight, throwLabel } from './phone/columnRead';
import { CardFlight } from './shared/CardFlight';
import { centreOf, edgeOfSeat, edgeRect } from './shared/flightPath';
import { isFlipped } from './shared/seating';
import { Invite, joinUrl, parseInvite, resolveInvite } from './shared/invite';
import { columnExtent, columnMetrics, sideMetrics } from './table/columnMetrics';
import { planFlight } from './table/flights';
import { JoinCode } from './table/JoinCode';
import { qrMatrix, qrPath } from './table/qrCode';
import { Lane, NameRow, SeatInvite, SeatPlate, SeatSlot } from './table/Table';
import { JoinScreen } from './phone/JoinScreen';
import { Phone } from './phone/Phone';
import { createInMemoryRejoinStore } from './session/rejoinStore';
import { createSessionStore } from './session/session';
import { FakeSocket } from './session/testDoubles';
import { SessionProvider } from './session/useSession';
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

  it('carries a second index at the opposite corner, for the shared discard row', () => {
    // Off everywhere else (CSS); on the DOM always, same as the near index —
    // this is the one place a card is read from both ends of the table at
    // once, with nobody's own reading direction to default to.
    const { container } = render(<Card card={num('blue', 7)} />);
    const far = container.querySelector('.card__index--far');
    expect(far?.textContent).toBe('7');
    expect(far?.getAttribute('aria-hidden')).toBe('true');
    expect(far).not.toBe(container.querySelector('.card__index'));
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

  it('renders in play order for both directions — the CSS mirrors the screen position, not the DOM', () => {
    // An upward column used to reverse the array here so the newest card
    // would land nearest the centre; that put it at the wrong edge. Both
    // directions now render the same DOM order and --i, and it is
    // .column--up's flex-direction: column-reverse plus .lane--top's
    // --dir-x that do the actual mirroring, in CSS, not here.
    const cards = [num('blue', 2), num('blue', 5), num('blue', 9)];
    for (const direction of ['down', 'up'] as const) {
      const { container } = render(<Column colour="blue" cards={cards} direction={direction} />);
      const rendered = Array.from(container.querySelectorAll('[data-card-id]')).map((el) =>
        el.getAttribute('data-card-id'),
      );
      expect(rendered).toEqual(['blue-2', 'blue-5', 'blue-9']);

      const indices = Array.from(container.querySelectorAll<HTMLElement>('.column__card')).map(
        (el) => el.style.getPropertyValue('--i'),
      );
      expect(indices).toEqual(['0', '1', '2']);
      cleanup();
    }
  });
});

describe('a lane: a column and its own live score', () => {
  it('shows no score for an unstarted column', () => {
    const { container } = render(<Column colour="white" cards={[]} direction="down" />);
    // Lane itself isn't rendered here — this pins the source Lane reads:
    // an empty column has nothing for scoreExpedition to be asked about.
    expect(container.querySelector('.lane__score')).toBeNull();
  });

  it('labels a losing column with its negative score', () => {
    const { container } = render(
      <Lane colour="blue" cards={[num('blue', 9)]} direction="down" arrivingId={null} />,
    );
    // (9 - 20) * 1 = -11 — a lone low card starting a column always loses.
    const score = container.querySelector('.lane__score');
    expect(score?.textContent).toBe('-11');
    expect(score?.className).toContain('is-negative');
  });

  it('signs a winning column, and drops the negative class', () => {
    const { container } = render(
      <Lane
        colour="blue"
        cards={[num('blue', 10), num('blue', 9), num('blue', 8)]}
        direction="down"
        arrivingId={null}
      />,
    );
    // (10+9+8 - 20) * 1 = 7
    const score = container.querySelector('.lane__score');
    expect(score?.textContent).toBe('+7');
    expect(score?.className).not.toContain('is-negative');
  });

  it('carries the top/bottom class through to the lane itself', () => {
    const { container: top } = render(
      <Lane colour="red" cards={[num('red', 5)]} direction="up" arrivingId={null} />,
    );
    expect(top.querySelector('.lane')?.className).toContain('lane--top');

    const { container: bottom } = render(
      <Lane colour="red" cards={[num('red', 5)]} direction="down" arrivingId={null} />,
    );
    expect(bottom.querySelector('.lane')?.className).toContain('lane--bottom');
  });
});

describe('a seat plate: the player at the edge of their own side', () => {
  function seatPlayer(overrides: Partial<PublicPlayerView> = {}): PublicPlayerView {
    return {
      seat: 0,
      name: 'Paul',
      connected: true,
      handCount: 8,
      expeditions: { yellow: [], blue: [], white: [], green: [], red: [] },
      roundScores: [10, -5],
      currentRoundScore: 3,
      ...overrides,
    };
  }

  it('shows the running total, not just the current round', () => {
    const { container } = render(
      <SeatPlate player={seatPlayer()} active={false} phase="place" flipped={false} />,
    );
    // 10 + -5 + 3 = 8
    expect(container.querySelector('.seat-plate__score')?.textContent).toBe('8');
  });

  it('names the phase and hand size only for the player whose turn it is', () => {
    const { container: waiting } = render(
      <SeatPlate player={seatPlayer()} active={false} phase="place" flipped={false} />,
    );
    expect(waiting.querySelector('.seat-plate__turn')).toBeNull();
    expect(waiting.querySelector('.seat-plate')?.className).not.toContain('is-active');

    const { container: active } = render(
      <SeatPlate player={seatPlayer()} active phase="draw" flipped={false} />,
    );
    expect(active.querySelector('.seat-plate__turn')?.textContent).toContain('Drawing a card');
    expect(active.querySelector('.seat-plate__turn')?.textContent).toContain('8 in hand');
    expect(active.querySelector('.seat-plate')?.className).toContain('is-active');
  });

  it('carries the flip class only for the player sitting opposite', () => {
    const { container: near } = render(
      <SeatPlate player={seatPlayer()} active={false} phase="place" flipped={false} />,
    );
    expect(near.querySelector('.seat-plate')?.className).not.toContain('seat-plate--flipped');

    const { container: far } = render(
      <SeatPlate player={seatPlayer()} active={false} phase="place" flipped />,
    );
    expect(far.querySelector('.seat-plate')?.className).toContain('seat-plate--flipped');
  });

  it('says so when the player has dropped', () => {
    const { container } = render(
      <SeatPlate player={seatPlayer({ connected: false })} active={false} phase="place" flipped={false} />,
    );
    expect(container.querySelector('.seat-plate__offline')).toBeTruthy();
  });

  it('carries the round counter, read by both — only the far one is flipped', () => {
    // Used to render only in the top row (Table.tsx), which the round
    // belonged to the table, not a player — but that meant only seat 0 ever
    // read it right-side up. Both rows carry it now.
    const { container: near } = render(
      <NameRow player={seatPlayer()} active={false} phase="place" flipped={false} round={2} />,
    );
    const nearChip = near.querySelector('.round-chip');
    expect(nearChip?.textContent).toBe('Round 2/3');

    const { container: far } = render(
      <NameRow player={seatPlayer()} active={false} phase="place" flipped round={2} />,
    );
    expect(far.querySelector('.round-chip')?.textContent).toBe('Round 2/3');
    expect(far.querySelector('.name-row')?.className).toContain('name-row--top');
    expect(near.querySelector('.name-row')?.className).toContain('name-row--bottom');
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

  it('always shows the draw pile count, once per end', () => {
    // Two chips, not one: the deck sits between both seats, same as a
    // discard pile, so each needs its own copy rather than leaning across
    // the table to read the other's.
    render(<DiscardRow deckCount={44} discardTops={noTops} />);
    expect(screen.getAllByText('44')).toHaveLength(2);
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
});

describe('how the hand wraps into rows', () => {
  it('stays one row up to four cards', () => {
    expect(perRow(1)).toBe(1);
    expect(perRow(4)).toBe(4);
  });

  it('balances a five-through-eight card hand across two rows', () => {
    // HAND_SIZE is 8 (shared/types.ts), so these are the counts a real hand
    // ever reaches: never front-loaded, e.g. 7 is 4-then-3, not 8-then(-1).
    expect(perRow(5)).toBe(3);
    expect(perRow(6)).toBe(3);
    expect(perRow(7)).toBe(4);
    expect(perRow(8)).toBe(4);
  });

  it('never divides by zero for an empty hand', () => {
    expect(perRow(0)).toBe(0);
  });
});

describe('the hand', () => {
  /** Press a card, drag it along a path of x/time pairs, let go. */
  function throwCard(
    container: HTMLElement,
    cardId: string,
    path: Array<{ x: number; t: number }>,
  ): void {
    const list = container.querySelector('.hand') as HTMLElement;
    // jsdom implements no layout and does not define elementFromPoint at
    // all, so stand in for the hit test a browser would do.
    stubElementFromPoint(() => container.querySelector(`[data-card-id="${cardId}"]`));

    fireEvent.pointerDown(list, { clientX: 0, clientY: 200, button: 0, timeStamp: 0 });
    for (const step of path) {
      fireEvent.pointerMove(list, { clientX: step.x, clientY: 200, timeStamp: step.t });
    }
    fireEvent.pointerUp(list, { clientX: path.at(-1)?.x ?? 0, clientY: 200 });
  }

  it('lays every card out in one row, addressable by id', () => {
    const { container } = render(
      <Hand
        cards={[num('blue', 2), num('red', 5), wager('green', 1)]}
        legalPlacements={{}}
        muted
      />,
    );

    const list = container.querySelector('.hand') as HTMLElement;
    expect(list.querySelectorAll('.hand__slot')).toHaveLength(3);
    // The row divides its width by the count; nothing is measured.
    expect(list.style.getPropertyValue('--hand-count')).toBe('3');
    for (const id of ['blue-2', 'red-5', 'green-w1']) {
      expect(container.querySelector(`[data-card-id="${id}"]`)).not.toBeNull();
    }
  });

  it('mutes a card with no legal target', () => {
    const { container } = render(
      <Hand cards={[num('blue', 2), num('red', 5)]} legalPlacements={{ 'blue-2': ['discard'] }} />,
    );

    expect(container.querySelector('[data-card-id="red-5"]')?.className).toContain('is-muted');
    expect(container.querySelector('[data-card-id="blue-2"]')?.className).not.toContain('is-muted');
  });

  it('stops marking cards unplayable once there is no placement to make', () => {
    // The server sends no legalPlacements during the draw phase, so reading
    // it then would grey out the entire hand — and the hand's colours are
    // exactly what decides which discard is worth taking.
    const { container } = render(<Hand cards={[num('blue', 2)]} legalPlacements={{}} muted />);

    const list = container.querySelector('.hand') as HTMLElement;
    expect(container.querySelector('[data-card-id="blue-2"]')?.className).not.toContain('is-muted');
    expect(list.className).toContain('is-muted'); // inert...
    expect(list.className).not.toContain('is-away'); // ...but not receded
  });

  it('picks a card up on contact, with no hold to wait out', () => {
    const onCarry = vi.fn();
    const { container } = render(
      <Hand
        cards={[num('blue', 2)]}
        legalPlacements={{ 'blue-2': ['discard'] }}
        onCarry={onCarry}
      />,
    );

    const list = container.querySelector('.hand') as HTMLElement;
    stubElementFromPoint(() => container.querySelector('[data-card-id="blue-2"]'));

    fireEvent.pointerDown(list, { clientX: 10, clientY: 10, button: 0, timeStamp: 0 });

    expect(onCarry).toHaveBeenCalledWith('blue-2');
    expect(container.querySelector('[data-card-id="blue-2"]')?.className).toContain('is-carried');
    expect(list.className).toContain('is-carrying');
  });

  it('arms the side the card is heading for, before the throw would land', () => {
    const onArmed = vi.fn();
    const { container } = render(
      <Hand
        cards={[num('blue', 2)]}
        legalPlacements={{ 'blue-2': ['discard', 'expedition'] }}
        onArmed={onArmed}
      />,
    );

    const list = container.querySelector('.hand') as HTMLElement;
    stubElementFromPoint(() => container.querySelector('[data-card-id="blue-2"]'));

    fireEvent.pointerDown(list, { clientX: 100, clientY: 200, button: 0, timeStamp: 0 });
    fireEvent.pointerMove(list, { clientX: 100 + ARM_DX + 5, clientY: 200, timeStamp: 40 });
    expect(onArmed).toHaveBeenLastCalledWith('expedition');

    fireEvent.pointerMove(list, { clientX: 100 - ARM_DX - 5, clientY: 200, timeStamp: 80 });
    expect(onArmed).toHaveBeenLastCalledWith('discard');
  });

  it('plays a card thrown right and discards one thrown left', () => {
    const onThrow = vi.fn();
    const { container } = render(
      <Hand
        cards={[num('blue', 2)]}
        legalPlacements={{ 'blue-2': ['discard', 'expedition'] }}
        onThrow={onThrow}
      />,
    );

    throwCard(container, 'blue-2', [{ x: THROW_DX + 20, t: 400 }]);
    expect(onThrow).toHaveBeenLastCalledWith('blue-2', 'expedition');

    throwCard(container, 'blue-2', [{ x: -THROW_DX - 20, t: 400 }]);
    expect(onThrow).toHaveBeenLastCalledWith('blue-2', 'discard');
  });

  it('refuses a throw at a direction the server did not offer', () => {
    const onThrow = vi.fn();
    const { container } = render(
      <Hand cards={[num('blue', 2)]} legalPlacements={{ 'blue-2': ['discard'] }} onThrow={onThrow} />,
    );

    throwCard(container, 'blue-2', [{ x: THROW_DX + 20, t: 400 }]);
    expect(onThrow).toHaveBeenLastCalledWith('blue-2', 'refuse');
  });

  it('keeps a second thumb landing mid-throw from stealing or interrupting the carry', () => {
    // The phone is held in two hands; a second thumb touching the row while
    // the first is mid-throw is the default grip, not an edge case.
    const onThrow = vi.fn();
    const { container } = render(
      <Hand
        cards={[num('blue', 2), num('red', 5)]}
        legalPlacements={{ 'blue-2': ['discard', 'expedition'], 'red-5': ['discard', 'expedition'] }}
        onThrow={onThrow}
      />,
    );

    const list = container.querySelector('.hand') as HTMLElement;
    stubElementFromPoint(() => container.querySelector('[data-card-id="blue-2"]'));
    fireEvent.pointerDown(list, { clientX: 0, clientY: 200, button: 0, timeStamp: 0, pointerId: 1 });

    // A second finger lands on a different card entirely.
    stubElementFromPoint(() => container.querySelector('[data-card-id="red-5"]'));
    fireEvent.pointerDown(list, { clientX: 300, clientY: 200, button: 0, timeStamp: 5, pointerId: 2 });

    // The second finger lifts first — it never started anything, so nothing
    // fires for it.
    fireEvent.pointerUp(list, { clientX: 300, clientY: 200, pointerId: 2 });
    expect(onThrow).not.toHaveBeenCalled();

    // The first finger, which actually owns the carry, throws blue-2 right.
    stubElementFromPoint(() => container.querySelector('[data-card-id="blue-2"]'));
    fireEvent.pointerMove(list, { clientX: THROW_DX + 20, clientY: 200, timeStamp: 400, pointerId: 1 });
    fireEvent.pointerUp(list, { clientX: THROW_DX + 20, clientY: 200, pointerId: 1 });

    expect(onThrow).toHaveBeenCalledTimes(1);
    expect(onThrow).toHaveBeenLastCalledWith('blue-2', 'expedition');
  });

  it('puts a card back when it is pressed and simply let go', () => {
    // Distance only. jsdom stamps its own clock on every event — the
    // timeStamp passed to fireEvent is discarded — so a release velocity
    // cannot be staged from here; `what a throw meant` covers that directly
    // against flickOutcome, where the numbers are the input.
    const onThrow = vi.fn();
    const { container } = render(
      <Hand
        cards={[num('blue', 2)]}
        legalPlacements={{ 'blue-2': ['discard', 'expedition'] }}
        onThrow={onThrow}
      />,
    );

    throwCard(container, 'blue-2', []);
    expect(onThrow).toHaveBeenLastCalledWith('blue-2', 'return');
  });

  it('treats a cancelled gesture as a card put back, never as a throw', () => {
    const onThrow = vi.fn();
    const { container } = render(
      <Hand
        cards={[num('blue', 2)]}
        legalPlacements={{ 'blue-2': ['discard', 'expedition'] }}
        onThrow={onThrow}
      />,
    );

    const list = container.querySelector('.hand') as HTMLElement;
    stubElementFromPoint(() => container.querySelector('[data-card-id="blue-2"]'));

    fireEvent.pointerDown(list, { clientX: 0, clientY: 200, button: 0, timeStamp: 0 });
    fireEvent.pointerMove(list, { clientX: THROW_DX + 60, clientY: 200, timeStamp: 60 });
    // An incoming call, a palm on the screen: the card was never thrown.
    fireEvent.pointerCancel(list, { clientX: THROW_DX + 60, clientY: 200 });

    expect(onThrow).toHaveBeenLastCalledWith('blue-2', 'return');
  });

  it('returns the card if pointer capture is lost mid-carry', () => {
    // No onLostPointerCapture handler and no window-level fallback meant a
    // dropped capture — a native drag stealing it, or a browser dropping it
    // during the ~60x/s re-render the follow loop drives — left the gesture
    // stuck 'carrying' forever: the rAF loop kept running and the card hung
    // under a finger that was no longer there.
    const onThrow = vi.fn();
    const { container } = render(
      <Hand
        cards={[num('blue', 2)]}
        legalPlacements={{ 'blue-2': ['discard', 'expedition'] }}
        onThrow={onThrow}
      />,
    );

    const list = container.querySelector('.hand') as HTMLElement;
    stubElementFromPoint(() => container.querySelector('[data-card-id="blue-2"]'));

    fireEvent.pointerDown(list, { clientX: 0, clientY: 200, button: 0, timeStamp: 0 });
    fireEvent.pointerMove(list, { clientX: THROW_DX + 60, clientY: 200, timeStamp: 60 });
    fireEvent.lostPointerCapture(list, { clientX: THROW_DX + 60, clientY: 200 });

    expect(onThrow).toHaveBeenLastCalledWith('blue-2', 'return');
    expect(list.className).not.toContain('is-carrying');
  });

  it('ignores a press that lands between cards', () => {
    const onCarry = vi.fn();
    const { container } = render(
      <Hand
        cards={[num('blue', 2)]}
        legalPlacements={{ 'blue-2': ['discard'] }}
        onCarry={onCarry}
      />,
    );

    const list = container.querySelector('.hand') as HTMLElement;
    stubElementFromPoint(() => null);

    fireEvent.pointerDown(list, { clientX: 10, clientY: 10, button: 0, timeStamp: 0 });
    fireEvent.pointerMove(list, { clientX: 400, clientY: 10, timeStamp: 40 });

    expect(onCarry).not.toHaveBeenCalled();
    expect(list.className).not.toContain('is-carrying');
  });

  it('is genuinely inert when this phone has nothing to place', () => {
    const onCarry = vi.fn();
    const { container } = render(
      <Hand cards={[num('blue', 2)]} legalPlacements={{}} muted onCarry={onCarry} />,
    );

    const list = container.querySelector('.hand') as HTMLElement;
    stubElementFromPoint(() => container.querySelector('[data-card-id="blue-2"]'));
    fireEvent.pointerDown(list, { clientX: 10, clientY: 10, button: 0, timeStamp: 0 });

    expect(onCarry).not.toHaveBeenCalled();
  });

  it('shakes the card the server refused', () => {
    const { container } = render(
      <Hand
        cards={[num('blue', 2)]}
        legalPlacements={{ 'blue-2': ['discard'] }}
        refusingId="blue-2"
      />,
    );
    expect(container.querySelector('[data-card-id="blue-2"]')?.className).toContain('is-refusing');
  });
});


describe('Phone: a refused move must not brick the hand', () => {
  function stubPlayerView(overrides: Partial<PlayerView> = {}): PlayerView {
    return {
      viewer: 'player',
      seat: 0,
      round: 1,
      stage: 'playing',
      deckCount: 44,
      discardTops: { yellow: null, blue: null, white: null, green: null, red: null },
      turn: 0,
      phase: 'place',
      readyForNextRound: [false, false],
      hand: [],
      legalPlacements: {},
      legalDrawSources: [],
      blockedDrawCardId: null,
      players: [
        {
          seat: 0,
          name: 'Paul',
          connected: true,
          handCount: 8,
          expeditions: { yellow: [], blue: [], white: [], green: [], red: [] },
          roundScores: [],
          currentRoundScore: 0,
        },
        {
          seat: 1,
          name: 'Aditi',
          connected: true,
          handCount: 8,
          expeditions: { yellow: [], blue: [], white: [], green: [], red: [] },
          roundScores: [],
          currentRoundScore: 0,
        },
      ],
      ...overrides,
    };
  }

  /** Press a card by id, drag it right past THROW_DX, let go. */
  function throwRight(container: HTMLElement, cardId: string): void {
    const list = container.querySelector('.hand') as HTMLElement;
    stubElementFromPoint(() => container.querySelector(`[data-card-id="${cardId}"]`));
    fireEvent.pointerDown(list, { clientX: 0, clientY: 200, button: 0, timeStamp: 0 });
    fireEvent.pointerMove(list, { clientX: THROW_DX + 20, clientY: 200, timeStamp: 400 });
    fireEvent.pointerUp(list, { clientX: THROW_DX + 20, clientY: 200 });
  }

  // This is the deadlock reported against the real app: a rejected `place`
  // replies with only an `error` — server/room.ts does not broadcast on a
  // refusal — and the phone had nothing but a fresh `view` to clear `busy`.
  // One refusal, ever, and the hand never accepted another throw.
  it('accepts a second throw after the server refuses the first', () => {
    const socket = new FakeSocket();
    const store = createSessionStore(socket, createInMemoryRejoinStore());
    const { container } = render(
      <SessionProvider store={store}>
        <Phone />
      </SessionProvider>,
    );
    // A device with no membership shows the join screen regardless of what
    // state arrives — join first, the way a real phone would. socket.deliver
    // and joinPlayer both push a synchronous update through
    // useSyncExternalStore from outside a React event handler, so each is
    // wrapped in act() the way the render it triggers needs.
    act(() => store.joinPlayer('417', 0, 'Paul'));

    act(() =>
      socket.deliver({
        t: 'state',
        view: stubPlayerView({
          hand: [{ id: 'blue-2', colour: 'blue', value: 2 }],
          legalPlacements: { 'blue-2': ['discard', 'expedition'] },
        }),
      }),
    );

    throwRight(container, 'blue-2');
    expect(socket.sent).toContainEqual({ t: 'place', cardId: 'blue-2', target: 'expedition' });

    // The server refuses it. No accompanying state — exactly what a real
    // refusal looks like (server/room.ts:90 replies sendError and returns
    // without broadcasting), and exactly why keying the busy flag on `view`
    // alone bricks the phone: on your own turn, nothing else produces a new
    // `state` until the opponent moves, so there is nothing left to clear it.
    act(() => socket.deliver({ t: 'error', message: 'Blue 2 is too low.' }));

    throwRight(container, 'blue-2');
    expect(socket.sent.filter((m) => m.t === 'place')).toHaveLength(2);
  });

  // Two identical refusals in a row must both be felt — the second one is
  // exactly where a `useEffect` keyed on the error string, rather than a
  // reply counter, would silently stop firing.
  it('reacts to a repeated identical refusal, not just the first one', () => {
    const socket = new FakeSocket();
    const store = createSessionStore(socket, createInMemoryRejoinStore());
    render(
      <SessionProvider store={store}>
        <Phone />
      </SessionProvider>,
    );
    act(() => store.joinPlayer('417', 0, 'Paul'));

    act(() =>
      socket.deliver({
        t: 'state',
        view: stubPlayerView({
          hand: [{ id: 'blue-2', colour: 'blue', value: 2 }],
          legalPlacements: { 'blue-2': ['discard', 'expedition'] },
        }),
      }),
    );

    act(() => socket.deliver({ t: 'error', message: 'Blue 2 is too low.' }));
    expect(store.getSeq()).toBe(2); // one state, one error

    act(() => socket.deliver({ t: 'error', message: 'Blue 2 is too low.' }));
    expect(store.getSeq()).toBe(3);
  });
});

describe('reading a column back', () => {
  it('names the cost of starting a column before the card leaves', () => {
    // There is no confirmation step: the throw is one motion, and stopping it
    // to ask "are you sure" would undo the point of the gesture. The label is
    // the warning.
    expect(throwLabel([], num('red', 4))).toBe('Start red · −20');
    expect(throwLabel([num('red', 2)], num('red', 4))).toBe('Play to red');
  });

  it('does not call a wager a commitment — it never starts the −20 on its own', () => {
    expect(placementWeight([], wager('red', 1))).toBe('normal');
    expect(placementWeight([], num('red', 4))).toBe('commits');
    expect(placementWeight([num('red', 2)], num('red', 4))).toBe('normal');
  });

  it('explains a dead direction as the state of the column', () => {
    expect(expeditionHint([num('blue', 7)], num('blue', 3))).toBe('blue is at 7');
    expect(expeditionHint([], num('blue', 3))).toBe('Cannot start blue');
    expect(expeditionHint([num('blue', 7)], wager('blue', 1))).toContain('wagers must come first');
    // Wagers already down do not count as the column being under way.
    expect(expeditionHint([wager('blue', 1)], wager('blue', 2))).toBe('Cannot start blue');
  });
});

describe('the two directions', () => {
  const zones = (
    card: CardModel,
    targets: Array<'expedition' | 'discard'>,
    column: CardModel[] = [],
    armed: 'expedition' | 'discard' | null = null,
  ) =>
    render(<FlickZones card={card} targets={targets} column={column} armed={armed} />).container;

  it('is scenery, not a target: nothing here can be hit or tapped', () => {
    const container = zones(num('red', 4), ['expedition', 'discard']);
    // The decision comes from the direction of the throw. If these were ever
    // hit-tested the gesture would have two answers.
    expect(container.querySelector('.flick-zones')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('button')).toBeNull();
  });

  it('takes the card’s own colour on the right and nothing on the left', () => {
    const container = zones(num('red', 4), ['expedition', 'discard']);
    const play = container.querySelector('.flick-zone--expedition') as HTMLElement;

    expect(play.style.getPropertyValue('--colour')).toBe('var(--colour-red)');
    expect(container.querySelector('.flick-zone--discard')?.textContent).toContain('Discard');
  });

  it('marks a direction dead rather than hiding it', () => {
    // Knowing which way is closed is the point; a missing half would just
    // read as the wash not having appeared.
    const container = zones(num('blue', 3), ['discard'], [num('blue', 7)]);
    const play = container.querySelector('.flick-zone--expedition') as HTMLElement;

    expect(play.className).toContain('is-dead');
    expect(play.textContent).toContain('blue is at 7');
    expect(container.querySelector('.flick-zone--discard')?.className).not.toContain('is-dead');
  });

  it('arms only the side being headed for, and never a dead one', () => {
    const live = zones(num('red', 4), ['expedition', 'discard'], [], 'expedition');
    expect(live.querySelector('.flick-zone--expedition')?.className).toContain('is-armed');
    expect(live.querySelector('.flick-zone--discard')?.className).not.toContain('is-armed');

    const dead = zones(num('blue', 3), ['discard'], [num('blue', 7)], 'expedition');
    const play = dead.querySelector('.flick-zone--expedition') as HTMLElement;
    // The class goes on, but is-dead is what the styling reads.
    expect(play.className).toContain('is-dead');
  });

  it('warns about a costly play in the label', () => {
    const container = zones(num('red', 4), ['expedition', 'discard']);
    const play = container.querySelector('.flick-zone--expedition') as HTMLElement;

    expect(play.className).toContain('is-costly');
    expect(play.textContent).toContain('−20');
  });
});

describe('every move in words', () => {
  const actions = (props: Partial<React.ComponentProps<typeof HandActions>> = {}) =>
    render(
      <HandActions
        hand={[num('blue', 2), num('red', 5)]}
        legalPlacements={{ 'blue-2': ['expedition', 'discard'], 'red-5': ['discard'] }}
        legalDrawSources={[]}
        discardTops={noTops}
        deckCount={44}
        phase="place"
        myTurn
        onPlace={vi.fn()}
        onDraw={vi.fn()}
        {...props}
      />,
    ).container;

  it('offers exactly the placements the server offered', () => {
    actions();
    expect(screen.getByText('Play blue 2 to your blue expedition')).toBeTruthy();
    expect(screen.getByText('Discard blue 2')).toBeTruthy();
    expect(screen.getByText('Discard red 5')).toBeTruthy();
    // red 5 has no expedition target, so there is no button for one.
    expect(screen.queryByText('Play red 5 to your red expedition')).toBeNull();
  });

  it('places the card it names', () => {
    const onPlace = vi.fn();
    actions({ onPlace });

    fireEvent.click(screen.getByText('Discard red 5'));
    expect(onPlace).toHaveBeenCalledWith('red-5', 'discard');
  });

  it('offers the draw sources instead, once it is time to draw', () => {
    const onDraw = vi.fn();
    actions({
      phase: 'draw',
      legalDrawSources: [{ kind: 'deck' }, { kind: 'discard', colour: 'green' }],
      discardTops: { ...noTops, green: num('green', 9), red: num('red', 3) },
      onDraw,
    });

    expect(screen.queryByText(/Play blue 2/)).toBeNull();
    fireEvent.click(screen.getByText('Draw from the deck, 44 left'));
    expect(onDraw).toHaveBeenCalledWith({ kind: 'deck' });

    fireEvent.click(screen.getByText('Take the green 9 from the discards'));
    expect(onDraw).toHaveBeenCalledWith({ kind: 'discard', colour: 'green' });
    // red has a top card but is not on offer — the blocked pile, or an
    // illegal one. It gets no button.
    expect(screen.queryByText(/red 3/)).toBeNull();
  });

  it('offers nothing at all when it is not this player’s turn', () => {
    const container = actions({ myTurn: false });
    expect(container.querySelector('button')).toBeNull();
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

describe('column metrics', () => {
  // 12 is the deepest column this game can deal: three wagers plus 2..10.
  const DEALABLE = Array.from({ length: 12 }, (_, i) => i + 1);

  it('fits any dealable column into exactly one side-height', () => {
    // The whole point. Card size and overlap used to be constants, so a
    // column's height depended only on its card count and nothing tied it to
    // the space available — a 3-card column came out 190px tall in a 128px
    // band and spilled over the scores and the turn text.
    for (const n of DEALABLE) {
      expect(columnExtent(n, columnMetrics(n))).toBeCloseTo(1, 6);
    }
  });

  it('keeps the card readable, tightening the stack instead', () => {
    // Two regimes: shrink the card while it can still be read across a
    // table, then stop and take the space out of the overlap.
    for (const n of DEALABLE) {
      expect(columnMetrics(n).cardFraction).toBeGreaterThanOrEqual(0.42);
    }

    const short = columnMetrics(3);
    const long = columnMetrics(10);
    expect(short.cardFraction).toBeGreaterThan(long.cardFraction);
    expect(short.show).toBe(0.17); // untightened while the card can shrink
    expect(long.show).toBeLessThan(short.show);
    expect(long.cardFraction).toBe(0.42); // on the floor
  });

  it('gives a lone card the whole band', () => {
    expect(columnMetrics(1).cardFraction).toBe(1);
    expect(columnExtent(1, columnMetrics(1))).toBe(1);
  });

  it('sizes a side by its longest column, so all five read at one scale', () => {
    expect(sideMetrics([1, 4, 0, 2, 3])).toEqual(columnMetrics(4));
    // An untouched side still has to produce usable numbers.
    expect(sideMetrics([0, 0, 0, 0, 0])).toEqual(columnMetrics(1));
    expect(sideMetrics([])).toEqual(columnMetrics(1));
  });

  it('degrades by clipping rather than by overflowing, past what is dealable', () => {
    // Unreachable in play, but the CSS clips this case instead of letting a
    // column paint over the bars again.
    expect(columnExtent(20, columnMetrics(20))).toBeGreaterThan(1);
    expect(columnMetrics(20).show).toBe(0.12);
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

  it('agrees with the card order Column actually renders', () => {
    // profilePoints maps cards[0] (oldest) to y≈1 — the SVG's own bottom —
    // for an upward column. Column renders cards[0] as its first DOM child
    // for 'up' too (see the "renders in play order" test above); it is
    // .column--up's flex-direction: column-reverse (app.css) that puts that
    // first DOM child at the *screen*-bottom of the column, next to the
    // discard row — the same end .lane--top pins the column to. So the
    // ridge's oldest point and the column's oldest, centre-adjacent card
    // land at the same screen position. This is the bug §7 fixed: the two
    // used to disagree.
    const cards = [num('blue', 2), num('blue', 10)];
    const { container } = render(<Column colour="blue" cards={cards} direction="up" />);
    const rendered = Array.from(container.querySelectorAll('[data-card-id]')).map((el) =>
      el.getAttribute('data-card-id'),
    );
    expect(rendered[0]).toBe(cards[0].id);
    expect(profilePoints(cards, 'up').split(' ')[0]).toBe('0.000,1.000');
  });
});

describe('carrying a card', () => {
  it('closes the gap toward the finger without ever passing it', () => {
    let at = { x: 0, y: 0 };
    const finger = { x: 100, y: -40 };

    for (let i = 0; i < 60; i += 1) {
      const next = followStep(at, finger, 16);
      // Monotone toward the target, never beyond it.
      expect(Math.abs(finger.x - next.x)).toBeLessThan(Math.abs(finger.x - at.x) + 1e-9);
      expect(next.x).toBeLessThanOrEqual(finger.x);
      at = next;
    }

    expect(isSettled(at, finger)).toBe(true);
  });

  it('covers the same ground however the frames fall', () => {
    // A slow device must not end up with a card further behind the finger —
    // that is exactly backwards, and it is what a fixed fraction per call
    // would do.
    const finger = { x: 100, y: 0 };
    let fast = { x: 0, y: 0 };
    for (let i = 0; i < 4; i += 1) fast = followStep(fast, finger, 16);
    const slow = followStep({ x: 0, y: 0 }, finger, 64);

    expect(slow.x).toBeCloseTo(fast.x, 6);
  });

  it('does nothing on a zero or backwards frame', () => {
    const at = { x: 5, y: 5 };
    expect(followStep(at, { x: 90, y: 0 }, 0)).toEqual(at);
    expect(followStep(at, { x: 90, y: 0 }, -8)).toEqual(at);
  });

  it('tilts with the lag, and stops tilting past the limit', () => {
    expect(tiltFor(0)).toBe(0);
    expect(tiltFor(20)).toBeGreaterThan(0);
    expect(tiltFor(-20)).toBe(-tiltFor(20));
    expect(tiltFor(10_000)).toBe(MAX_TILT_DEG);
    expect(tiltFor(-10_000)).toBe(-MAX_TILT_DEG);
  });

  it('measures speed over the tail of the gesture, not the whole of it', () => {
    // Swept far, then held still before letting go. That is not a throw, and
    // averaging the whole drag would call it one.
    const paused = [
      { x: 0, t: 0 },
      { x: 300, t: 100 },
      { x: 302, t: 400 },
      { x: 303, t: 460 },
    ];
    expect(Math.abs(velocityFrom(paused))).toBeLessThan(FLICK_V);

    const flicked = [
      { x: 0, t: 400 },
      { x: 40, t: 440 },
      { x: 90, t: 470 },
    ];
    expect(velocityFrom(flicked)).toBeGreaterThan(FLICK_V);
  });

  it('has no opinion about speed without two samples to compare', () => {
    expect(velocityFrom([])).toBe(0);
    expect(velocityFrom([{ x: 10, t: 1 }])).toBe(0);
    // Two samples at the same instant would divide by zero.
    expect(velocityFrom([{ x: 0, t: 5 }, { x: 40, t: 5 }])).toBe(0);
  });

  it('keeps the sample window bounded', () => {
    const samples = [
      { x: 0, t: 0 },
      { x: 10, t: 500 },
      { x: 20, t: 560 },
    ];
    expect(trimSamples(samples, 570).map((s) => s.t)).toEqual([500, 560]);
  });
});

describe('what a throw meant', () => {
  const both: Array<'expedition' | 'discard'> = ['expedition', 'discard'];

  it('commits on speed alone, even from a short drag', () => {
    expect(flickOutcome({ dx: 20, vx: FLICK_V + 0.2, legalTargets: both })).toBe('expedition');
    expect(flickOutcome({ dx: -20, vx: -FLICK_V - 0.2, legalTargets: both })).toBe('discard');
  });

  it('commits on distance alone, however slowly it was pushed', () => {
    expect(flickOutcome({ dx: THROW_DX + 1, vx: 0, legalTargets: both })).toBe('expedition');
    expect(flickOutcome({ dx: -THROW_DX - 1, vx: 0, legalTargets: both })).toBe('discard');
  });

  it('puts the card back when it was neither thrown nor pushed far', () => {
    expect(flickOutcome({ dx: THROW_DX - 1, vx: FLICK_V - 0.01, legalTargets: both })).toBe(
      'return',
    );
    expect(flickOutcome({ dx: 0, vx: 0, legalTargets: both })).toBe('return');
  });

  it('lets the last thing the hand did win', () => {
    // Dragged well left, then flicked back to the right before letting go.
    expect(flickOutcome({ dx: -200, vx: FLICK_V + 0.3, legalTargets: both })).toBe('expedition');
  });

  it('refuses a direction the server did not offer', () => {
    expect(flickOutcome({ dx: 200, vx: 0, legalTargets: ['discard'] })).toBe('refuse');
    // ...and never turns it into the other direction instead.
    expect(flickOutcome({ dx: 200, vx: 0, legalTargets: [] })).toBe('refuse');
  });

  it('arms a side well before that side would commit', () => {
    expect(armedSide(0)).toBeNull();
    expect(armedSide(ARM_DX - 1)).toBeNull();
    expect(armedSide(ARM_DX + 1)).toBe('expedition');
    expect(armedSide(-ARM_DX - 1)).toBe('discard');
    expect(ARM_DX).toBeLessThan(THROW_DX);
  });
});

describe('the gesture machine', () => {
  const press = { t: 'down', cardId: 'blue-2', pointerId: 1, x: 100, y: 300, at: 0 } as const;

  it('carries a card from the moment it is pressed', () => {
    const state = gestureReducer(initialGesture, press);
    expect(state.phase).toBe('carrying');
    expect(state.cardId).toBe('blue-2');
    expect(state.pointerId).toBe(1);
    expect(dragOf(state)).toEqual({ x: 0, y: 0 });
  });

  it('stays idle on a press that landed between cards', () => {
    const state = gestureReducer(initialGesture, { ...press, cardId: null });
    expect(state.phase).toBe('idle');
  });

  it('tracks the finger and remembers where it started', () => {
    let state = gestureReducer(initialGesture, press);
    state = gestureReducer(state, { t: 'move', pointerId: 1, x: 160, y: 280, at: 30 });
    expect(dragOf(state)).toEqual({ x: 60, y: -20 });
  });

  it('collects samples to judge the release by', () => {
    let state = gestureReducer(initialGesture, press);
    state = gestureReducer(state, { t: 'move', pointerId: 1, x: 130, y: 300, at: 30 });
    state = gestureReducer(state, { t: 'move', pointerId: 1, x: 190, y: 300, at: 60 });

    expect(velocityFrom(state.samples)).toBeGreaterThan(0);
  });

  it('ignores movement when nothing is being carried', () => {
    const state = gestureReducer(initialGesture, { t: 'move', pointerId: 1, x: 500, y: 0, at: 10 });
    expect(state).toBe(initialGesture);
  });

  it('lets go completely, so nothing carries into the next gesture', () => {
    let state = gestureReducer(initialGesture, press);
    state = gestureReducer(state, { t: 'move', pointerId: 1, x: 400, y: 100, at: 40 });

    expect(gestureReducer(state, { t: 'up', pointerId: 1 })).toEqual(initialGesture);
    expect(gestureReducer(state, { t: 'cancel', pointerId: 1 })).toEqual(initialGesture);
  });
});

describe('a second finger must not steal or interrupt a carry', () => {
  const press = { t: 'down', cardId: 'blue-2', pointerId: 1, x: 100, y: 300, at: 0 } as const;

  it('ignores a second down while one pointer is already carrying', () => {
    const carrying = gestureReducer(initialGesture, press);
    const after = gestureReducer(carrying, {
      t: 'down',
      cardId: 'red-5',
      pointerId: 2,
      x: 400,
      y: 300,
      at: 10,
    });
    expect(after).toBe(carrying);
  });

  it('ignores a move from a pointer that never started the carry', () => {
    const carrying = gestureReducer(initialGesture, press);
    const after = gestureReducer(carrying, { t: 'move', pointerId: 2, x: 500, y: 0, at: 20 });
    expect(after).toBe(carrying);
  });

  it('ignores an up or cancel from a foreign pointer, without resetting the carry', () => {
    const carrying = gestureReducer(initialGesture, press);
    expect(gestureReducer(carrying, { t: 'up', pointerId: 2 })).toBe(carrying);
    expect(gestureReducer(carrying, { t: 'cancel', pointerId: 2 })).toBe(carrying);
  });

  it('still lets go on the owning pointer once the foreign one has come and gone', () => {
    let state = gestureReducer(initialGesture, press);
    state = gestureReducer(state, { t: 'down', cardId: 'red-5', pointerId: 2, x: 400, y: 300, at: 10 });
    state = gestureReducer(state, { t: 'up', pointerId: 2 });
    expect(gestureReducer(state, { t: 'up', pointerId: 1 })).toEqual(initialGesture);
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

describe('flight paths', () => {
  const rect = { x: 100, y: 200, width: 80, height: 120 };
  const viewport = { width: 800, height: 400 };

  it('puts a thrown card clear of the edge, not flush with it', () => {
    // Flush would leave the card half on screen while it fades, which reads
    // as the animation giving up rather than the card leaving.
    expect(edgeRect(rect, 'left', viewport).x).toBeLessThan(-rect.width);
    expect(edgeRect(rect, 'right', viewport).x).toBeGreaterThan(viewport.width);
    expect(edgeRect(rect, 'top', viewport).y).toBeLessThan(-rect.height);
    expect(edgeRect(rect, 'bottom', viewport).y).toBeGreaterThan(viewport.height);
  });

  it('keeps the other axis and the size, so a card leaves in a straight line', () => {
    const thrown = edgeRect(rect, 'right', viewport);
    expect(thrown.y).toBe(rect.y);
    expect(thrown.width).toBe(rect.width);
    expect(thrown.height).toBe(rect.height);

    const dropped = edgeRect(rect, 'bottom', viewport);
    expect(dropped.x).toBe(rect.x);
  });

  it('reads the same journey both ways round', () => {
    // A throw off the bottom and an arrival over the bottom are one rect.
    expect(edgeRect(rect, 'bottom', viewport)).toEqual(edgeRect(rect, 'bottom', viewport));
    expect(edgeOfSeat(0)).toBe('bottom');
    expect(edgeOfSeat(1)).toBe('top');
  });

  it('agrees with seating.ts, the one place this mapping actually lives', () => {
    expect(isFlipped(0)).toBe(false);
    expect(isFlipped(1)).toBe(true);
  });

  it('finds the centre of a rect', () => {
    expect(centreOf(rect)).toEqual({ x: 140, y: 260 });
  });
});

describe('reaching across the table for a card', () => {
  it('takes a card pulled toward the seat that is drawing', () => {
    // Seat 0 reads the table from the bottom, so its own edge is downward.
    expect(reachOutcome({ dy: REACH_PX + 1, vy: 0, seat: 0 })).toBe('take');
    expect(reachOutcome({ dy: -REACH_PX - 1, vy: 0, seat: 1 })).toBe('take');
    expect(towardSeat(0)).toBe(1);
    expect(towardSeat(1)).toBe(-1);
  });

  it('puts it back when the pull went the other way', () => {
    // This is the whole reason the table can take input at all: a lean or the
    // wrong player's stray swipe does not travel toward the seat on turn.
    expect(reachOutcome({ dy: -200, vy: -3, seat: 0 })).toBe('return');
    expect(reachOutcome({ dy: 200, vy: 3, seat: 1 })).toBe('return');
  });

  it('puts it back when the pull was too small to mean anything', () => {
    expect(reachOutcome({ dy: REACH_PX - 1, vy: 0, seat: 0 })).toBe('return');
    expect(reachOutcome({ dy: 0, vy: 0, seat: 0 })).toBe('return');
  });

  it('takes a quick flick that never travelled far', () => {
    expect(reachOutcome({ dy: 10, vy: FLICK_V + 0.5, seat: 0 })).toBe('take');
    expect(reachOutcome({ dy: -10, vy: -FLICK_V - 0.5, seat: 1 })).toBe('take');
  });

  it('asks for less than a throw does, because a reach is not a throw', () => {
    expect(REACH_PX).toBeLessThan(THROW_DX);
  });
});

describe('the discard row', () => {
  const tops = { ...noTops, green: num('green', 9), red: num('red', 3) };

  function reach(el: HTMLElement, dy: number): void {
    fireEvent.pointerDown(el, { clientX: 100, clientY: 300, button: 0 });
    fireEvent.pointerMove(el, { clientX: 100, clientY: 300 + dy });
    fireEvent.pointerUp(el, { clientX: 100, clientY: 300 + dy });
  }

  it('is inert with no draw sources — which is every phase but one', () => {
    const onDraw = vi.fn();
    const { container } = render(
      <DiscardRow deckCount={40} discardTops={tops} legalDrawSources={[]} activeSeat={0} onDraw={onDraw} />,
    );

    reach(container.querySelector('[data-pile="green"]') as HTMLElement, 120);
    expect(onDraw).not.toHaveBeenCalled();
    expect(container.querySelector('.discard-row')?.className).not.toContain('is-armed');
  });

  it('marks whose turn it is on its own edge, every turn — not just while armed', () => {
    // The only other "whose turn" cue is on the active player's own name
    // plate, at the far edge of their own side — this is the one a glance
    // across the table also catches, and it has to work outside a draw
    // phase too, or it would only ever show for half of each player's turn.
    const { container: seat0Turn } = render(
      <DiscardRow deckCount={40} discardTops={tops} activeSeat={0} />,
    );
    expect(seat0Turn.querySelector('.discard-row')?.className).toContain(
      'discard-row--turn-bottom',
    );

    const { container: seat1Turn } = render(
      <DiscardRow deckCount={40} discardTops={tops} activeSeat={1} />,
    );
    expect(seat1Turn.querySelector('.discard-row')?.className).toContain('discard-row--turn-top');

    const { container: noTurn } = render(<DiscardRow deckCount={40} discardTops={tops} />);
    expect(noTurn.querySelector('.discard-row')?.className).not.toContain('discard-row--turn');
  });

  it('draws the deck as a stack of backs, and keeps the anchor addressable', () => {
    const { container } = render(<DiscardRow deckCount={44} discardTops={noTops} />);

    const deck = container.querySelector('[data-deck]');
    expect(deck).toBeTruthy();
    expect(deck?.querySelectorAll('.card--back').length).toBeGreaterThan(0);
    // Capped at 3 for depth, however many cards are actually left.
    expect(deck?.querySelectorAll('.card--back').length).toBeLessThanOrEqual(3);
    expect(deck?.querySelector('.deck__count')?.textContent).toBe('44');
    expect(deck?.className).toContain('deck--normal');
  });

  it('shows no backs once the deck is empty, count included', () => {
    const { container } = render(<DiscardRow deckCount={0} discardTops={noTops} />);

    const deck = container.querySelector('[data-deck]');
    expect(deck?.querySelectorAll('.card--back').length).toBe(0);
    expect(deck?.querySelector('.deck__count')?.textContent).toBe('0');
    expect(deck?.className).toContain('deck--critical');
  });

  it('draws the pile that was pulled toward the player on turn', () => {
    const onDraw = vi.fn();
    const { container } = render(
      <DiscardRow
        deckCount={40}
        discardTops={tops}
        legalDrawSources={[{ kind: 'deck' }, { kind: 'discard', colour: 'green' }]}
        activeSeat={0}
        onDraw={onDraw}
      />,
    );

    reach(container.querySelector('[data-pile="green"]') as HTMLElement, REACH_PX + 20);
    expect(onDraw).toHaveBeenCalledWith({ kind: 'discard', colour: 'green' });

    reach(container.querySelector('[data-deck]') as HTMLElement, REACH_PX + 20);
    expect(onDraw).toHaveBeenLastCalledWith({ kind: 'deck' });
  });

  it('ignores a pull on a pile the server did not offer', () => {
    const onDraw = vi.fn();
    const { container } = render(
      <DiscardRow
        deckCount={40}
        discardTops={tops}
        legalDrawSources={[{ kind: 'discard', colour: 'green' }]}
        activeSeat={0}
        onDraw={onDraw}
      />,
    );

    // red has a top card, but it is blocked or otherwise not on offer.
    reach(container.querySelector('[data-pile="red"]') as HTMLElement, REACH_PX + 20);
    expect(onDraw).not.toHaveBeenCalled();
  });

  it('ignores a pull away from the seat that is drawing', () => {
    const onDraw = vi.fn();
    const { container } = render(
      <DiscardRow
        deckCount={40}
        discardTops={tops}
        legalDrawSources={[{ kind: 'discard', colour: 'green' }]}
        activeSeat={0}
        onDraw={onDraw}
      />,
    );

    reach(container.querySelector('[data-pile="green"]') as HTMLElement, -REACH_PX - 40);
    expect(onDraw).not.toHaveBeenCalled();
  });

  it('marks a wrong-way pull while it is happening', () => {
    const { container } = render(
      <DiscardRow
        deckCount={40}
        discardTops={tops}
        legalDrawSources={[{ kind: 'discard', colour: 'green' }]}
        activeSeat={0}
        onDraw={vi.fn()}
      />,
    );

    const pile = container.querySelector('[data-pile="green"]') as HTMLElement;
    fireEvent.pointerDown(pile, { clientX: 100, clientY: 300, button: 0 });
    fireEvent.pointerMove(pile, { clientX: 100, clientY: 260 });

    expect(pile.className).toContain('is-reaching');
    expect(pile.className).toContain('is-wrong-way');
    expect(pile.style.transform).toBe('translateY(-40.0px)');
  });

  it('leaves a taken card where the finger left it, for the flight to pick up', () => {
    // Snapping it home and flying it out again would animate the journey the
    // player just made by hand.
    const { container } = render(
      <DiscardRow
        deckCount={40}
        discardTops={tops}
        legalDrawSources={[{ kind: 'discard', colour: 'green' }]}
        activeSeat={0}
        onDraw={vi.fn()}
      />,
    );

    const pile = container.querySelector('[data-pile="green"]') as HTMLElement;
    reach(pile, REACH_PX + 20);
    expect(pile.style.transform).toBe(`translateY(${(REACH_PX + 20).toFixed(1)}px)`);
  });
});

describe('planning a card’s journey across the table', () => {
  const seated = (seat: 0 | 1, name: string): PublicPlayerView => ({
    seat,
    name,
    connected: true,
    handCount: 8,
    expeditions: { yellow: [], blue: [], white: [], green: [], red: [] },
    roundScores: [],
    currentRoundScore: 0,
  });

  const tableView = (tops: Partial<Record<Colour, CardModel | null>> = {}): TableView => ({
    viewer: 'table',
    round: 1,
    stage: 'playing',
    deckCount: 40,
    discardTops: { ...noTops, ...tops },
    turn: 0,
    phase: 'place',
    legalDrawSources: [],
    readyForNextRound: [false, false],
    players: [seated(0, 'Paul'), seated(1, 'Aditi')],
  });

  it('flies a placed card in over its own player’s edge', () => {
    const card = num('blue', 7);
    const plan = planFlight({ name: 'placed', seat: 0, card, target: 'expedition' }, tableView());

    expect(plan).toEqual({
      card,
      anchor: '[data-card-id="blue-7"]',
      edge: 'bottom',
      direction: 'in',
      hideCardId: 'blue-7',
      spin: 0,
    });
  });

  it('comes in over the far edge for the player sitting opposite', () => {
    const plan = planFlight(
      { name: 'placed', seat: 1, card: num('red', 3), target: 'discard' },
      tableView(),
    );
    expect(plan?.edge).toBe('top');
  });

  it('holds an arriving card back until it lands', () => {
    // It is in the state that came with the cue, so it is on the table before
    // the flight starts. Without this the animation covers a card that has
    // already popped into place.
    const plan = planFlight(
      { name: 'placed', seat: 0, card: num('green', 4), target: 'expedition' },
      tableView(),
    );
    expect(plan?.hideCardId).toBe('green-4');
  });

  it('takes the drawn card off the pile as it stood a moment ago', () => {
    // The state arriving with this cue no longer has that card anywhere: the
    // previous view is the only place it still exists.
    const taken = num('green', 9);
    const plan = planFlight(
      { name: 'drew', seat: 1, source: { kind: 'discard', colour: 'green' } },
      tableView({ green: taken }),
    );

    expect(plan).toEqual({
      card: taken,
      anchor: '[data-pile="green"]',
      edge: 'top',
      direction: 'out',
      hideCardId: null,
      spin: 0,
    });
  });

  it('sends a deck draw out face down, because nobody saw it', () => {
    const plan = planFlight({ name: 'drew', seat: 0, source: { kind: 'deck' } }, tableView());

    expect(plan?.card).toBeNull();
    expect(plan?.anchor).toBe('[data-deck]');
    expect(plan?.direction).toBe('out');
  });

  it('has nothing to fly for a screen change', () => {
    expect(planFlight({ name: 'roundOver' }, tableView())).toBeNull();
    expect(planFlight({ name: 'matchOver', winner: 0 }, tableView())).toBeNull();
  });

  it('turns to face the far player landing on their own expedition, and nothing else', () => {
    // Seat 1's expedition faces them; the shared discard pile does not, so a
    // discard from either seat lands upright, and so does seat 0's own
    // expedition — it already faces the table's own default orientation.
    const far = num('blue', 7);
    const near = num('red', 3);
    expect(
      planFlight({ name: 'placed', seat: 1, card: far, target: 'expedition' }, tableView())?.spin,
    ).toBe(180);
    expect(
      planFlight({ name: 'placed', seat: 1, card: near, target: 'discard' }, tableView())?.spin,
    ).toBe(0);
    expect(
      planFlight({ name: 'placed', seat: 0, card: near, target: 'expedition' }, tableView())?.spin,
    ).toBe(0);
    // Drawing never turns — the source is a shared, upright pile either way.
    expect(
      planFlight({ name: 'drew', seat: 1, source: { kind: 'deck' } }, tableView())?.spin,
    ).toBe(0);
  });
});

describe('the join link', () => {
  const location = { origin: 'http://192.168.1.5:3001', pathname: '/table' };

  it('encodes the room and the seat, and swaps the table path for the phone one', () => {
    expect(joinUrl(location, { code: '417', seat: 0 })).toBe(
      'http://192.168.1.5:3001/play?code=417&seat=0',
    );
  });

  it('round-trips through parseInvite for both seats', () => {
    for (const seat of [0, 1] as const) {
      const invite: Invite = { code: '417', seat };
      expect(parseInvite(new URL(joinUrl(location, invite)).search)).toEqual(invite);
    }
  });

  it('keeps a subpath install’s prefix, so a PR preview still produces a working link', () => {
    const url = joinUrl({ origin: 'http://x', pathname: '/preview-42/table' }, { code: '417', seat: 1 });
    expect(url).toBe('http://x/preview-42/play?code=417&seat=1');
  });

  it('refuses a missing, short, or leading-zero code rather than guess', () => {
    expect(parseInvite('')).toBeNull();
    expect(parseInvite('?code=12&seat=0')).toBeNull();
    expect(parseInvite('?code=099&seat=0')).toBeNull();
    expect(parseInvite('?code=abc&seat=0')).toBeNull();
  });

  it('refuses a missing or out-of-range seat', () => {
    expect(parseInvite('?code=417')).toBeNull();
    expect(parseInvite('?code=417&seat=2')).toBeNull();
  });
});

describe('which invite wins', () => {
  it('lets a scanned link for a different room override a stored membership', () => {
    expect(resolveInvite({ code: '417', seat: 0 }, '512')).toEqual({ code: '417', seat: 0 });
  });

  it('is a no-op for the room this device already joined — re-scanning just resumes', () => {
    expect(resolveInvite({ code: '417', seat: 0 }, '417')).toBeNull();
  });

  it('is a no-op with nothing scanned', () => {
    expect(resolveInvite(null, '417')).toBeNull();
  });
});

describe('a QR, as data', () => {
  it('produces a square matrix with the three finder patterns in the corners', () => {
    const matrix = qrMatrix('http://192.168.1.5:3001/play?code=417&seat=0');

    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix.length % 2).toBe(1); // QR versions are always odd-sized
    for (const row of matrix) expect(row).toHaveLength(matrix.length);

    // The outer ring of each 7x7 finder square is a solid line — enough to
    // tell this is a real code and not noise, without shipping a decoder.
    const n = matrix.length;
    expect(matrix[0].slice(0, 7).every(Boolean)).toBe(true); // top-left
    expect(matrix[0].slice(n - 7).every(Boolean)).toBe(true); // top-right
    expect(matrix[n - 1].slice(0, 7).every(Boolean)).toBe(true); // bottom-left
  });

  it('turns a hand-checked matrix into the expected path and viewBox', () => {
    const matrix = [
      [true, false, true],
      [false, true, false],
      [true, false, true],
    ];
    expect(qrPath(matrix, 1)).toEqual({
      d: 'M1 1h1v1h-1zM3 1h1v1h-1zM2 2h1v1h-1zM1 3h1v1h-1zM3 3h1v1h-1z',
      size: 5,
    });
  });

  it('draws nothing for an all-light matrix, not a broken path', () => {
    expect(qrPath([[false, false], [false, false]]).d).toBe('');
  });
});

describe('the join code, drawn', () => {
  it('renders as a named, decodable image', () => {
    render(<JoinCode url="http://x/play?code=417&seat=0" label="Scan to join as seat 1" />);
    const svg = screen.getByRole('img', { name: 'Scan to join as seat 1' });
    expect(svg.querySelector('path')?.getAttribute('d')).toBeTruthy();
  });
});

describe('a seat slot in the lobby', () => {
  const invites: SeatInvite[] = [
    { seat: 0, url: 'http://x/play?code=417&seat=0' },
    { seat: 1, url: 'http://x/play?code=417&seat=1' },
  ];

  it('shows a QR for an empty seat that has one', () => {
    render(<SeatSlot seat={0} invites={invites} />);
    expect(screen.getByRole('img', { name: /seat 1/i })).toBeTruthy();
  });

  it('shows the player’s name instead once they are connected, never both', () => {
    render(<SeatSlot seat={0} name="Paul" invites={invites} />);
    expect(screen.getByText('Paul')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('falls back to plain waiting text when no invites were given', () => {
    // The demo's table has no /play route to send anyone to.
    render(<SeatSlot seat={1} />);
    expect(screen.getByText(/seat 2 — waiting/i)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('the join screen', () => {
  function codeInput(container: HTMLElement) {
    return container.querySelector<HTMLInputElement>('.join__code')!;
  }
  function nameInput(container: HTMLElement) {
    return container.querySelector<HTMLInputElement>('.join__name')!;
  }

  it('starts blank and focuses the code field, with nothing yet to send', () => {
    const { container } = render(<JoinScreen onJoin={vi.fn()} />);
    expect(codeInput(container).value).toBe('');
    expect(document.activeElement).toBe(codeInput(container));
    expect((screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('prefills from a scanned invite, focuses the name, and joins on submit with just a name typed', () => {
    const onJoin = vi.fn();
    const { container } = render(<JoinScreen initialCode="417" initialSeat={1} onJoin={onJoin} />);

    expect(codeInput(container).value).toBe('417');
    expect(document.activeElement).toBe(nameInput(container));
    expect(screen.getByRole('button', { name: 'Seat 2' }).className).toContain('is-selected');

    fireEvent.change(nameInput(container), { target: { value: 'Paul' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(onJoin).toHaveBeenCalledWith('417', 1, 'Paul');
  });

  it('offers a remembered name as a default, editable like any other field', () => {
    const { container } = render(<JoinScreen initialName="Paul" onJoin={vi.fn()} />);
    expect(nameInput(container).value).toBe('Paul');
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
