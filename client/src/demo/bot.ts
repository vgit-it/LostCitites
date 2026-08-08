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

import { ClientMessage, PlayerView, Seat, ServerMessage } from '@shared/types';
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
  /** Send as this seat, for the one intent the bot has no opinion about. */
  send(message: ClientMessage): void;
  /** Give up the seat, so a person can take it. */
  close(): void;
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

    send: (message) => socket.send(message),

    close() {
      if (timer) clearTimeout(timer);
      timer = null;
      socket.close();
    },
  };
}

export interface PumpResult {
  /** Whether it stopped because `done` held, rather than running out of moves. */
  reached: boolean;
  /** Half-turns played. */
  steps: number;
}

/**
 * Runs bots until nobody can move or `done` holds.
 *
 * An explicit trampoline, not recursion: with sync delivery each step lands
 * the server's answer before it returns, so a whole match unwinds in one
 * stack frame instead of a few hundred.
 */
export function pump(
  bots: Bot[],
  done: (steps: number) => boolean,
  guard = 2000,
): PumpResult {
  let steps = 0;
  while (steps < guard) {
    if (done(steps)) return { reached: true, steps };
    if (!bots.some((bot) => bot.step())) return { reached: done(steps), steps };
    steps += 1;
  }
  throw new Error('bots did not reach the target position');
}
