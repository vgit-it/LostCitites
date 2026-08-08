// ============================================================
// Room code generation and lookup, kept apart from Room itself so it
// needs no knowledge of sockets. It receives a channel *factory*, not a
// transport, which is what keeps it decoupled from I/O.
//
// v1 only ever holds one room, but nothing here assumes that.
// ============================================================

import { RoomChannel } from './broadcaster';
import { Rng, systemRng } from './rng';
import { Room } from './room';

/** A room plus the channel its connections bind to. */
export interface RoomEntry {
  room: Room;
  channel: RoomChannel;
}

export interface RoomRegistry {
  /**
   * `preferredCode` is honoured when it is well-formed and free, otherwise a
   * fresh code is generated. The tablet supplies the code it is already
   * displaying: the wire views carry no code field, so a server-invented one
   * could never reach the tablet to be shown.
   */
  create(preferredCode?: string): RoomEntry;
  get(code: string): RoomEntry | undefined;
}

/** 3 digits, 100-999. No leading zero, so it is unambiguous read aloud. */
const MIN_CODE = 100;
const MAX_CODE = 999;
const CODE_SPACE = MAX_CODE - MIN_CODE + 1;

export function isValidCode(code: string): boolean {
  return /^[1-9][0-9]{2}$/.test(code);
}

export class InMemoryRoomRegistry implements RoomRegistry {
  private readonly entries = new Map<string, RoomEntry>();

  constructor(
    private readonly makeChannel: () => RoomChannel,
    private readonly rng: Rng = systemRng,
  ) {}

  create(preferredCode?: string): RoomEntry {
    const code =
      preferredCode && isValidCode(preferredCode) && !this.entries.has(preferredCode)
        ? preferredCode
        : this.generateCode();
    const channel = this.makeChannel();
    const entry: RoomEntry = {
      channel,
      room: new Room(code, { broadcaster: channel, rng: this.rng }),
    };
    this.entries.set(code, entry);
    return entry;
  }

  get(code: string): RoomEntry | undefined {
    return this.entries.get(code);
  }

  private generateCode(): string {
    if (this.entries.size >= CODE_SPACE) throw new Error('No room codes left.');

    for (;;) {
      const code = String(MIN_CODE + Math.floor(this.rng() * CODE_SPACE));
      if (!this.entries.has(code)) return code;
    }
  }
}
