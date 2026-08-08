// ============================================================
// Demo routing, in the hash.
//
// The LAN build routes on pathname and keeps doing so — its server has an
// SPA fallback, so /table and /play resolve. A static host has neither that
// fallback nor a guarantee of being served from the domain root, so a
// pathname route would 404 twice over. Everything after the '#' is never
// sent to a server and never has to exist as a file.
//
// The query lives inside the hash too, so a whole demo URL is one
// copyable unit rather than a path and a search string that have to travel
// together.
// ============================================================

// main.tsx imports this module eagerly, to decide whether the page is a demo
// at all. So it must stay free of value imports from the rest of demo/ —
// one import of scenarios.ts would pull the bot, the hub and the whole
// server into the main bundle and undo the code split. `Seat` is a type and
// erases; DEFAULT_SCENARIO lives here, and scenarios.ts reads it from here.
import type { Seat } from '@shared/types';

export type DemoView = 'index' | 'panes' | 'table' | 'play';

/** The position a bare #/demo link opens on. */
export const DEFAULT_SCENARIO = 'midround';

export interface DemoParams {
  view: DemoView;
  seat: Seat;
  scenario: string;
  seed: number;
  /** Whether a bot plays any seat a person has not taken. */
  bot: boolean;
}

/** Fixed rather than random, so a bare #/demo link is reproducible too. */
export const DEFAULT_SEED = 20260808;

export const DEFAULT_PARAMS: DemoParams = {
  view: 'index',
  seat: 0,
  scenario: DEFAULT_SCENARIO,
  seed: DEFAULT_SEED,
  bot: true,
};

/**
 * Parses a location hash, or null when it is not a demo route at all —
 * which is what keeps the LAN build's own routing untouched.
 */
export function parseDemoHash(hash: string): DemoParams | null {
  const raw = hash.replace(/^#/, '');
  const [path, search] = raw.split('?');
  const segments = path.split('/').filter(Boolean);

  if (segments[0] !== 'demo') return null;

  const query = new URLSearchParams(search ?? '');
  const seed = Number(query.get('seed'));

  const params: DemoParams = {
    ...DEFAULT_PARAMS,
    scenario: query.get('scenario') ?? DEFAULT_PARAMS.scenario,
    seed: Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : DEFAULT_SEED,
    bot: query.get('bot') !== '0',
  };

  if (segments.length === 1) return { ...params, view: 'panes' };
  if (segments[1] === 'table') return { ...params, view: 'table' };
  if (segments[1] === 'play') {
    return { ...params, view: 'play', seat: segments[2] === '1' ? 1 : 0 };
  }
  return { ...params, view: 'index' };
}

/** The inverse, for the pane iframes and the copy-link control. */
export function demoHash(params: Partial<DemoParams> = {}): string {
  const { view, seat, scenario, seed, bot } = { ...DEFAULT_PARAMS, ...params };

  const path =
    view === 'table' ? '/demo/table' : view === 'play' ? `/demo/play/${seat}` : '/demo';

  const query = new URLSearchParams({ scenario, seed: String(seed) });
  if (!bot) query.set('bot', '0');

  return `#${path}?${query}`;
}
