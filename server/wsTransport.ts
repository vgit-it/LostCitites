// ============================================================
// The `ws` adapter. Along with index.ts, the only server file that
// imports the WebSocket library at all.
// ============================================================

import type { RawData, WebSocket } from 'ws';
import { Connection } from './transport';

export function fromWebSocket(socket: WebSocket): Connection {
  return {
    send(raw: string): void {
      // A socket that closed between broadcast and flush is normal here.
      if (socket.readyState === socket.OPEN) socket.send(raw);
    },
    onMessage(handler: (raw: string) => void): void {
      socket.on('message', (data: RawData) => handler(data.toString()));
    },
    onClose(handler: () => void): void {
      socket.on('close', handler);
      socket.on('error', handler);
    },
    close(): void {
      socket.close();
    },
  };
}
