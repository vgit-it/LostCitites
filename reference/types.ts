// ============================================================
// Lost Cities — shared state model
// Imported by server, phone client, and table client.
// ============================================================

export type Colour = 'yellow' | 'blue' | 'white' | 'green' | 'red';

export const COLOURS: Colour[] = ['yellow', 'blue', 'white', 'green', 'red'];

/** 'wager' cards have no numeric value. Numbers run 2..10. */
export type CardValue = 'wager' | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface Card {
  /** Stable unique id, e.g. "blue-7" or "blue-w1". Used for all client intents. */
  id: string;
  colour: Colour;
  value: CardValue;
}

export type Seat = 0 | 1;

/** Which half of a turn we're in. A turn is always place-then-draw. */
export type Phase = 'place' | 'draw';

export type DrawSource = { kind: 'deck' } | { kind: 'discard'; colour: Colour };

export type PlaceTarget = { kind: 'expedition' } | { kind: 'discard' };

// ------------------------------------------------------------
// Authoritative state (server only — never sent as-is)
// ------------------------------------------------------------

export interface PlayerState {
  seat: Seat;
  name: string;
  connected: boolean;
  hand: Card[];
  /** Cards played to each expedition, in play order (ascending). */
  expeditions: Record<Colour, Card[]>;
  /** One entry per completed round. */
  roundScores: number[];
}

export interface GameState {
  round: 1 | 2 | 3;
  /** 'lobby' before deal; 'roundEnd' between rounds; 'matchEnd' when done. */
  stage: 'lobby' | 'playing' | 'roundEnd' | 'matchEnd';
  deck: Card[];
  discards: Record<Colour, Card[]>;
  players: [PlayerState, PlayerState];
  turn: Seat;
  phase: Phase;
  /**
   * Set when the current player discards. Blocks re-drawing that exact card
   * during the same turn's draw phase. Cleared at end of turn.
   */
  blockedDrawCardId: string | null;
  /** Both seats must set this true to advance past roundEnd. */
  readyForNextRound: [boolean, boolean];
}

// ------------------------------------------------------------
// Filtered views (what actually goes over the wire)
// ------------------------------------------------------------

export interface PublicPlayerView {
  seat: Seat;
  name: string;
  connected: boolean;
  handCount: number;
  expeditions: Record<Colour, Card[]>;
  roundScores: number[];
  /** Live score for the current round, recomputed each broadcast. */
  currentRoundScore: number;
}

export interface BaseView {
  round: 1 | 2 | 3;
  stage: GameState['stage'];
  deckCount: number;
  /** Top card of each discard pile, or null if empty. */
  discardTops: Record<Colour, Card | null>;
  turn: Seat;
  phase: Phase;
  players: [PublicPlayerView, PublicPlayerView];
  readyForNextRound: [boolean, boolean];
}

/** Sent to the shared table device. Contains no hands. */
export interface TableView extends BaseView {
  viewer: 'table';
}

/** Sent to a phone. Contains only that phone's own hand. */
export interface PlayerView extends BaseView {
  viewer: 'player';
  seat: Seat;
  hand: Card[];
  /** Precomputed so the phone needs no rules logic. */
  legalPlacements: Record<string, PlaceTarget['kind'][]>;
  legalDrawSources: DrawSource[];
  blockedDrawCardId: string | null;
}

export type ClientView = TableView | PlayerView;

// ------------------------------------------------------------
// Messages
// ------------------------------------------------------------

export type ClientMessage =
  | { t: 'joinTable'; code: string }
  | { t: 'joinPlayer'; code: string; seat: Seat; name: string }
  | { t: 'startRound' }
  | { t: 'place'; cardId: string; target: PlaceTarget['kind'] }
  | { t: 'draw'; source: DrawSource }
  | { t: 'readyNextRound' };

export type ServerMessage =
  | { t: 'state'; view: ClientView }
  | { t: 'error'; message: string }
  | { t: 'event'; kind: TableEvent };

/** Fire-and-forget cues for table animations. State is still the source of truth. */
export type TableEvent =
  | { name: 'placed'; seat: Seat; card: Card; target: PlaceTarget['kind'] }
  | { name: 'drew'; seat: Seat; source: DrawSource }
  | { name: 'roundOver' }
  | { name: 'matchOver'; winner: Seat | 'tie' };

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------

export const HAND_SIZE = 8;
export const EXPEDITION_COST = 20;
export const BONUS_THRESHOLD = 8;
export const BONUS_POINTS = 20;
export const ROUNDS = 3;
