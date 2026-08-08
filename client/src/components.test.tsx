// @vitest-environment jsdom
//
// Leaf components, rendered from fixture props. No provider, no socket,
// no mocking — which is the point of keeping them presentational.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Card as CardModel, Colour, PublicPlayerView } from '@shared/types';
import { Card } from './shared/Card';
import { Column } from './table/Column';
import { profilePoints } from './table/ElevationProfile';
import { DiscardRow, deckUrgency } from './table/DiscardRow';
import { PlayerBreakdown } from './table/RoundEnd';
import { Hand, sortHand } from './phone/Hand';
import { DrawTargets } from './phone/DrawTargets';
import { PlaceActions, expeditionHint } from './phone/PlaceActions';

afterEach(cleanup);

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

  it('greys a card with no legal target and does not select it', () => {
    const onSelect = vi.fn();
    render(
      <Hand
        cards={[num('blue', 2), num('red', 5)]}
        legalPlacements={{ 'blue-2': ['discard'] }}
        selectedId={null}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByLabelText('red 5'));
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('blue 2'));
    expect(onSelect).toHaveBeenCalledWith('blue-2');
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
