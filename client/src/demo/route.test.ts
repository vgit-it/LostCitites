import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENARIO,
  DEFAULT_SEED,
  DemoParams,
  demoHash,
  parseDemoHash,
} from './route';

describe('demo routing', () => {
  it('leaves the LAN build alone', () => {
    // Anything that is not a demo route returns null, which is what keeps
    // main.tsx's pathname routing — and its live socket — untouched.
    expect(parseDemoHash('')).toBeNull();
    expect(parseDemoHash('#')).toBeNull();
    expect(parseDemoHash('#/table')).toBeNull();
    expect(parseDemoHash('#/play/0')).toBeNull();
    expect(parseDemoHash('#/demolition')).toBeNull();
  });

  it('reads the three interfaces', () => {
    expect(parseDemoHash('#/demo')?.view).toBe('panes');
    expect(parseDemoHash('#/demo/table')?.view).toBe('table');
    expect(parseDemoHash('#/demo/play/0')).toMatchObject({ view: 'play', seat: 0 });
    expect(parseDemoHash('#/demo/play/1')).toMatchObject({ view: 'play', seat: 1 });
  });

  it('defaults a bare demo link to something reproducible', () => {
    expect(parseDemoHash('#/demo')).toMatchObject({
      scenario: DEFAULT_SCENARIO,
      seed: DEFAULT_SEED,
      bot: true,
    });
  });

  it('reads the query from inside the hash', () => {
    expect(parseDemoHash('#/demo/play/1?scenario=roundend&seed=42&bot=0')).toEqual({
      view: 'play',
      seat: 1,
      scenario: 'roundend',
      seed: 42,
      bot: false,
    });
  });

  it('falls back to the default seed rather than dealing from nonsense', () => {
    for (const bad of ['seed=0', 'seed=-3', 'seed=abc', 'seed=']) {
      expect(parseDemoHash(`#/demo?${bad}`)?.seed).toBe(DEFAULT_SEED);
    }
    expect(parseDemoHash('#/demo?seed=99.7')?.seed).toBe(99);
  });

  it('treats an unknown seat as seat 0 instead of failing', () => {
    expect(parseDemoHash('#/demo/play/7')?.seat).toBe(0);
    expect(parseDemoHash('#/demo/play')?.seat).toBe(0);
  });

  it('round-trips: what demoHash writes, parseDemoHash reads back', () => {
    const cases: Partial<DemoParams>[] = [
      { view: 'panes' },
      { view: 'table', scenario: 'lobby', seed: 7 },
      { view: 'play', seat: 1, scenario: 'matchend', seed: 999, bot: false },
      { view: 'play', seat: 0, scenario: 'blocked', seed: 1, bot: true },
    ];

    for (const params of cases) {
      const hash = demoHash(params);
      expect(parseDemoHash(hash), hash).toMatchObject(params);
    }
  });

  it('writes bot only when it is off, so links stay short', () => {
    expect(demoHash({ view: 'panes', bot: true })).not.toContain('bot');
    expect(demoHash({ view: 'panes', bot: false })).toContain('bot=0');
  });
});
