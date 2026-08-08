// ============================================================
// An opponent that plays random legal moves.
//
// Deliberately a *client*, not something bolted into Room. It never sees
// GameState; it reads `legalPlacements` and `legalDrawSources` off the
// PlayerView the server already ships, and sends ordinary intents back.
// That is the same move-picking shape as playTurn in
// scripts/headlessGame.ts, moved to the far side of the wire — and it
// doubles as a standing check that a PlayerView really does carry
// everything a player needs in order to act.
//
// It acts a half-turn at a time, because it reads `phase` from the view
// anyway. That is what lets a scenario stop between a place and a draw.
// ============================================================

import { PlayerView, Seat, ServerMessage } from '@shared/types';
import { Rng } from '../../../server/rng';
import { SocketClient } from '../session/socket';
import { DEMO_CODE } from './hub';

/** How long a watching human gets between the bot's half-turns. */
export const BOT_THINK_MS = 700;

export interface Bot {
  readonly seat: Seat;
  /** The most recent view, or null before the first frame. */
  view(): PlayerView | null;
  /**
   * Act once if it is this bot's move. Returns whether it did.
   *
   * Callers drive this in a loop rather than the bot acting inside its own
   * message handler: under sync delivery that would recurse once per
   * half-turn, and a full match is a few hundred of them.
   */
  step(): boolean;
  /** Self-drive with a pause between moves, for a game being watched. */
  start(delayMs?: number): void;
  stop(): void;
}

function pick<T>(items: T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)];
}

export function createBot(
  socket: SocketClient,
  seat: Seat,
  rng: Rng,
  code: string = DEMO_CODE,
): Bot {
  let view: PlayerView | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Stops a second act on a view already acted on, e.g. after an error frame. */
  let actedOn: string | null = null;

  socket.onMessage((message: ServerMessage) => {
    if (message.t !== 'state') return;
    if (message.view.viewer !== 'player' || message.view.seat !== seat) return;
    view = message.view;
  });

  socket.send({ t: 'joinPlayer', code, seat, name: seat === 0 ? 'Ada' : 'Bo' });

  /** A stamp for "this exact position", so the bot moves once per position. */
  function positionKey(current: PlayerView): string {
    return `${current.stage}:${current.round}:${current.turn}:${current.phase}:${current.hand.length}:${current.deckCount}`;
  }

  function step(): boolean {
    const current = view;
    if (!current) return false;

    if (current.stage === 'roundEnd') {
      if (current.readyForNextRound[seat]) return false;
      socket.send({ t: 'readyNextRound' });
      return true;
    }

    if (current.stage !== 'playing' || current.turn !== seat) return false;

    const key = positionKey(current);
    if (key === actedOn) return false;
    actedOn = key;

    if (current.phase === 'place') {
      const cardIds = Object.keys(current.legalPlacements);
      if (cardIds.length === 0) return false;
      const cardId = pick(cardIds, rng);
      socket.send({ t: 'place', cardId, target: pick(current.legalPlacements[cardId], rng) });
      return true;
    }

    if (current.legalDrawSources.length === 0) return false;
    socket.send({ t: 'draw', source: pick(current.legalDrawSources, rng) });
    return true;
  }

  function tick(delayMs: number): void {
    timer = setTimeout(() => {
      step();
      tick(delayMs);
    }, delayMs);
  }

  return {
    seat,
    view: () => view,
    step,

    start(delayMs = BOT_THINK_MS) {
      if (timer) return;
      tick(delayMs);
    },

    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * Runs bots until nobody can move or `done()` holds, and returns whether it
 * stopped because `done()` held rather than because it ran out of moves.
 *
 * An explicit trampoline, not recursion: with sync delivery each step lands
 * the server's answer before it returns, so a whole match unwinds in one
 * stack frame instead of a few hundred.
 */
export function pump(bots: Bot[], done: () => boolean, guard = 2000): boolean {
  for (let i = 0; i < guard; i++) {
    if (done()) return true;
    if (!bots.some((bot) => bot.step())) return done();
  }
  throw new Error('bots did not reach the target position');
}
