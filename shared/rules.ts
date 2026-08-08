// ============================================================
// Lost Cities — pure rules layer.
// No I/O, no sockets. Every function is deterministic given its inputs
// (except buildDeck's shuffle, which takes an injectable RNG).
// ============================================================

import {
  BONUS_POINTS,
  BONUS_THRESHOLD,
  COLOURS,
  Card,
  Colour,
  DrawSource,
  EXPEDITION_COST,
  GameState,
  HAND_SIZE,
  PlaceTarget,
  PlayerState,
  Seat,
} from './types';

// ------------------------------------------------------------
// Deck
// ------------------------------------------------------------

/** 60 cards: per colour, 2..10 plus three wagers. */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const colour of COLOURS) {
    for (let v = 2; v <= 10; v++) {
      deck.push({ id: `${colour}-${v}`, colour, value: v as Card['value'] });
    }
    for (let w = 1; w <= 3; w++) {
      deck.push({ id: `${colour}-w${w}`, colour, value: 'wager' });
    }
  }
  return deck;
}

/** Fisher-Yates. Pass a seeded RNG if you want reproducible games for testing. */
export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function emptyExpeditions(): Record<Colour, Card[]> {
  return { yellow: [], blue: [], white: [], green: [], red: [] };
}

function emptyDiscards(): Record<Colour, Card[]> {
  return { yellow: [], blue: [], white: [], green: [], red: [] };
}

// ------------------------------------------------------------
// Round setup
// ------------------------------------------------------------

/**
 * Deals a fresh round in place. Preserves names, connection status,
 * and accumulated roundScores.
 */
export function dealRound(
  state: GameState,
  firstPlayer: Seat,
  rng: () => number = Math.random,
): void {
  const deck = shuffle(buildDeck(), rng);

  for (const seat of [0, 1] as Seat[]) {
    const p = state.players[seat];
    p.hand = deck.splice(0, HAND_SIZE);
    p.expeditions = emptyExpeditions();
  }

  state.deck = deck;
  state.discards = emptyDiscards();
  state.turn = firstPlayer;
  state.phase = 'place';
  state.blockedDrawCardId = null;
  state.readyForNextRound = [false, false];
  state.stage = 'playing';
}

// ------------------------------------------------------------
// Validation
// ------------------------------------------------------------

export type Validation = { ok: true } | { ok: false; reason: string };

const OK: Validation = { ok: true };
const fail = (reason: string): Validation => ({ ok: false, reason });

/**
 * Can this card legally extend this expedition column?
 *
 * Two independent constraints:
 *   - Wagers may only be laid before any number card of that colour.
 *   - Number cards must strictly exceed the last number card played.
 *
 * Note "strictly": the deck has one of each number per colour, so equal
 * values can never collide in a single column anyway. Kept strict for clarity.
 */
export function canPlaceOnExpedition(column: Card[], card: Card): Validation {
  const numbers = column.filter((c) => c.value !== 'wager');

  if (card.value === 'wager') {
    if (numbers.length > 0) {
      return fail('Wagers must be played before any number card in that colour.');
    }
    return OK;
  }

  if (numbers.length === 0) return OK;

  const last = numbers[numbers.length - 1].value as number;
  if ((card.value as number) <= last) {
    return fail(`Must play higher than ${last} in ${card.colour}.`);
  }
  return OK;
}

export function validatePlace(
  state: GameState,
  seat: Seat,
  cardId: string,
  target: PlaceTarget['kind'],
): Validation {
  if (state.stage !== 'playing') return fail('Round is not in progress.');
  if (state.turn !== seat) return fail('Not your turn.');
  if (state.phase !== 'place') return fail('You have already placed; draw a card.');

  const card = state.players[seat].hand.find((c) => c.id === cardId);
  if (!card) return fail('Card not in your hand.');

  if (target === 'discard') return OK;

  return canPlaceOnExpedition(state.players[seat].expeditions[card.colour], card);
}

export function validateDraw(
  state: GameState,
  seat: Seat,
  source: DrawSource,
): Validation {
  if (state.stage !== 'playing') return fail('Round is not in progress.');
  if (state.turn !== seat) return fail('Not your turn.');
  if (state.phase !== 'draw') return fail('You must place a card first.');

  if (source.kind === 'deck') {
    if (state.deck.length === 0) return fail('Draw pile is empty.');
    return OK;
  }

  const pile = state.discards[source.colour];
  if (pile.length === 0) return fail('That discard pile is empty.');

  const top = pile[pile.length - 1];
  if (top.id === state.blockedDrawCardId) {
    return fail('You cannot take back the card you just discarded.');
  }
  return OK;
}

// ------------------------------------------------------------
// Mutation
// ------------------------------------------------------------

/** Caller must have run validatePlace first. */
export function applyPlace(
  state: GameState,
  seat: Seat,
  cardId: string,
  target: PlaceTarget['kind'],
): Card {
  const player = state.players[seat];
  const idx = player.hand.findIndex((c) => c.id === cardId);
  const [card] = player.hand.splice(idx, 1);

  if (target === 'discard') {
    state.discards[card.colour].push(card);
    state.blockedDrawCardId = card.id;
  } else {
    player.expeditions[card.colour].push(card);
    state.blockedDrawCardId = null;
  }

  state.phase = 'draw';
  return card;
}

/**
 * Caller must have run validateDraw first.
 * Ends the turn. If the draw emptied the deck, the round ends immediately —
 * the drawing player keeps the card but does not get another turn.
 */
export function applyDraw(state: GameState, seat: Seat, source: DrawSource): Card {
  const player = state.players[seat];

  const card =
    source.kind === 'deck'
      ? state.deck.pop()!
      : state.discards[source.colour].pop()!;

  player.hand.push(card);

  state.blockedDrawCardId = null;

  if (state.deck.length === 0) {
    endRound(state);
    return card;
  }

  state.turn = (seat === 0 ? 1 : 0) as Seat;
  state.phase = 'place';
  return card;
}

// ------------------------------------------------------------
// Scoring
// ------------------------------------------------------------

/**
 * Score one expedition column.
 *
 *   empty column                  -> 0, no penalty
 *   otherwise  (sum - 20) * (1 + wagers), then +20 if 8+ cards
 *
 * The bonus is added AFTER the multiplier. Wagers count toward the 8-card
 * threshold. Wagers multiply losses as well as gains.
 */
export function scoreExpedition(column: Card[]): number {
  if (column.length === 0) return 0;

  const wagers = column.filter((c) => c.value === 'wager').length;
  const sum = column
    .filter((c) => c.value !== 'wager')
    .reduce((acc, c) => acc + (c.value as number), 0);

  let score = (sum - EXPEDITION_COST) * (1 + wagers);
  if (column.length >= BONUS_THRESHOLD) score += BONUS_POINTS;

  return score;
}

export function scorePlayer(player: PlayerState): number {
  return COLOURS.reduce((acc, c) => acc + scoreExpedition(player.expeditions[c]), 0);
}

/** Per-colour breakdown for the table's round-end screen. */
export function scoreBreakdown(player: PlayerState): Record<Colour, number> {
  const out = {} as Record<Colour, number>;
  for (const c of COLOURS) out[c] = scoreExpedition(player.expeditions[c]);
  return out;
}

function endRound(state: GameState): void {
  for (const seat of [0, 1] as Seat[]) {
    state.players[seat].roundScores.push(scorePlayer(state.players[seat]));
  }
  state.stage = state.round === 3 ? 'matchEnd' : 'roundEnd';
}

export function totalScore(player: PlayerState): number {
  return player.roundScores.reduce((a, b) => a + b, 0);
}

/** Higher total after three rounds wins. */
export function matchWinner(state: GameState): Seat | 'tie' {
  const a = totalScore(state.players[0]);
  const b = totalScore(state.players[1]);
  if (a === b) return 'tie';
  return a > b ? 0 : 1;
}

/**
 * Advance to the next round once both players are ready.
 * Higher scorer of the round just played leads; ties keep the previous leader.
 */
export function advanceRound(
  state: GameState,
  rng: () => number = Math.random,
): void {
  const last = state.round;
  const a = state.players[0].roundScores[last - 1];
  const b = state.players[1].roundScores[last - 1];
  const firstPlayer: Seat = a === b ? state.turn : a > b ? 0 : 1;

  state.round = (last + 1) as 1 | 2 | 3;
  dealRound(state, firstPlayer, rng);
}

// ------------------------------------------------------------
// Legal-move precomputation (so the phone needs no rules logic)
// ------------------------------------------------------------

export function legalPlacementsFor(
  state: GameState,
  seat: Seat,
): Record<string, PlaceTarget['kind'][]> {
  const out: Record<string, PlaceTarget['kind'][]> = {};
  if (state.turn !== seat || state.phase !== 'place') return out;

  for (const card of state.players[seat].hand) {
    const targets: PlaceTarget['kind'][] = ['discard'];
    if (canPlaceOnExpedition(state.players[seat].expeditions[card.colour], card).ok) {
      targets.unshift('expedition');
    }
    out[card.id] = targets;
  }
  return out;
}

export function legalDrawSourcesFor(state: GameState, seat: Seat): DrawSource[] {
  if (state.turn !== seat || state.phase !== 'draw') return [];

  const sources: DrawSource[] = [];
  if (state.deck.length > 0) sources.push({ kind: 'deck' });

  for (const colour of COLOURS) {
    if (validateDraw(state, seat, { kind: 'discard', colour }).ok) {
      sources.push({ kind: 'discard', colour });
    }
  }
  return sources;
}
