// ============================================================
// The socket seam. Deliberately typed on raw strings so it mirrors the
// `ws` API 1:1 and knows nothing about the protocol — no JSON parsing,
// no roles, no game state. Everything above this line is testable with
// a plain object implementing Connection.
// ============================================================

export interface Connection {
  send(raw: string): void;
  onMessage(handler: (raw: string) => void): void;
  onClose(handler: () => void): void;
  close(): void;
}
