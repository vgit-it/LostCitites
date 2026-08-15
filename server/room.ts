// ============================================================
// The room state machine. Owns one GameState and is the only thing that
// mutates it — always through rules.ts, never by touching arrays directly.
//
// Collaborators (Broadcaster, Rng) are injected, so the whole class is
// exercisable with a recording fake and a seeded RNG. It must never import
// `ws`, `express`, or a concrete broadcaster.
// ============================================================

import {
  advanceRound,
  applyDraw,
  applyPlace,
  dealRound,
  matchWinner,
  validateDraw,
  validatePlace,
} from '@shared/rules';
import { DrawSource, GameState, PlaceTarget, Seat, TableEvent } from '@shared/types';
import { ALL_ROLES, Broadcaster, ClientRole, roleOfSeat, seatOfRole } from './broadcaster';
import { createInitialState } from './initialState';
import { Rng, systemRng } from './rng';
import { buildViews } from './views';

export interface RoomDeps {
  broadcaster: Broadcaster;
  rng?: Rng;
}

export class Room {
  readonly code: string;

  private readonly state: GameState;
  private readonly broadcaster: Broadcaster;
  private readonly rng: Rng;

  constructor(code: string, deps: RoomDeps) {
    this.code = code;
    this.broadcaster = deps.broadcaster;
    this.rng = deps.rng ?? systemRng;
    this.state = createInitialState();
  }

  // ----------------------------------------------------------
  // Membership
  // ----------------------------------------------------------

  /** The table holds no seat; it just starts receiving state. */
  bindTable(): void {
    this.broadcast();
  }

  /**
   * Claim or re-claim a seat. A second connection for an occupied seat
   * replaces the first: this is a LAN game with no adversaries, and
   * rejecting would strand a phone that slept mid-game.
   */
  bindPlayer(seat: Seat, name: string): void {
    const player = this.state.players[seat];
    if (name.trim().length > 0) player.name = name.trim();
    player.connected = true;
    this.broadcast();
  }

  /** Disconnect only marks the seat. The room is never destroyed. */
  unbind(role: ClientRole): void {
    const seat = seatOfRole(role);
    if (seat !== null) this.state.players[seat].connected = false;
    this.broadcast();
  }

  // ----------------------------------------------------------
  // Turn actions
  // ----------------------------------------------------------

  startRound(): void {
    if (this.state.stage !== 'lobby') {
      return this.errorToAll('The game has already started.');
    }
    if (!this.state.players[0].connected || !this.state.players[1].connected) {
      return this.errorToAll('Both players must join before dealing.');
    }

    dealRound(this.state, 0, this.rng);
    this.broadcast();
  }

  place(seat: Seat, cardId: string, target: PlaceTarget['kind']): void {
    const check = validatePlace(this.state, seat, cardId, target);
    if (!check.ok) return this.broadcaster.sendError(roleOfSeat(seat), check.reason);

    const card = applyPlace(this.state, seat, cardId, target);
    this.emit({ name: 'placed', seat, card, target });
    this.broadcast();
  }

  /**
   * A draw taken from the tablet, on behalf of whoever is to move.
   *
   * The table holds no seat, so the acting seat can only come from the turn —
   * which is why the router cannot simply forward this to `draw`. The stage
   * and phase are checked here rather than left to `validateDraw` so the
   * refusal reads as "nobody is drawing" rather than naming a seat the tablet
   * never claimed.
   */
  drawFromTable(source: DrawSource): void {
    if (this.state.stage !== 'playing' || this.state.phase !== 'draw') {
      return this.broadcaster.sendError('table', 'No one is drawing right now.');
    }
    this.draw(this.state.turn, source, 'table');
  }

  /**
   * `replyTo` is where a refusal goes. It defaults to the acting seat, and is
   * only ever otherwise for a draw the tablet made on that seat's behalf —
   * the phone should not be told off for a gesture it did not make.
   */
  draw(seat: Seat, source: DrawSource, replyTo: ClientRole = roleOfSeat(seat)): void {
    const check = validateDraw(this.state, seat, source);
    if (!check.ok) return this.broadcaster.sendError(replyTo, check.reason);

    applyDraw(this.state, seat, source);
    this.emit({ name: 'drew', seat, source });

    // applyDraw ends the round internally when it empties the deck. The rules
    // layer has no way to announce that, so the cues are raised here.
    if (this.state.stage === 'roundEnd') this.emit({ name: 'roundOver' });
    if (this.state.stage === 'matchEnd') {
      this.emit({ name: 'roundOver' });
      this.emit({ name: 'matchOver', winner: matchWinner(this.state) });
    }

    this.broadcast();
  }

  /**
   * Advances past the round-end screen once both seats are ready.
   * Never called at matchEnd — advanceRound would set round to 4.
   */
  readyNextRound(seat: Seat): void {
    if (this.state.stage !== 'roundEnd') {
      return this.broadcaster.sendError(roleOfSeat(seat), 'The round is still in progress.');
    }

    this.state.readyForNextRound[seat] = true;
    if (this.state.readyForNextRound[0] && this.state.readyForNextRound[1]) {
      advanceRound(this.state, this.rng);
    }
    this.broadcast();
  }

  /** Tests and debugging only. Production views come from views.ts. */
  snapshot(): Readonly<GameState> {
    return this.state;
  }

  // ----------------------------------------------------------
  // Outbound
  // ----------------------------------------------------------

  private broadcast(): void {
    const views = buildViews(this.state);
    this.broadcaster.sendState('table', views.table);
    this.broadcaster.sendState('seat0', views.seat0);
    this.broadcaster.sendState('seat1', views.seat1);
  }

  /** Cosmetic cues. A dropped event is corrected by the next state. */
  private emit(event: TableEvent): void {
    for (const role of ALL_ROLES) this.broadcaster.sendEvent(role, event);
  }

  private errorToAll(message: string): void {
    for (const role of ALL_ROLES) this.broadcaster.sendError(role, message);
  }
}
