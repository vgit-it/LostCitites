// ============================================================
// Composition root. Wires Express, the HTTP server, and `ws` to the
// router. Contains no branching on message type — that lives in router.ts.
// ============================================================

import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { InMemoryRoomRegistry } from './registry';
import { RoomBroadcaster } from './roomBroadcaster';
import { handleConnection } from './router';
import { fromWebSocket } from './wsTransport';

/** Must match SERVER_PORT in vite.config.ts. */
const SERVER_PORT = Number(process.env.PORT ?? 3001);
const WS_PATH = '/ws';

const here = dirname(fileURLToPath(import.meta.url));
const clientDist = join(here, '..', 'dist', 'client');

const app = express();

// In development Vite serves the client and proxies /ws here, so dist/ is
// absent and this whole block is skipped.
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // Everything else is an SPA route: /, /table, /play.
  app.use((_req, res) => res.sendFile(join(clientDist, 'index.html')));
}

const server = createServer(app);
const registry = new InMemoryRoomRegistry(() => new RoomBroadcaster());
const wss = new WebSocketServer({ server, path: WS_PATH });

wss.on('connection', (socket) => handleConnection(fromWebSocket(socket), registry));

server.listen(SERVER_PORT, '0.0.0.0', () => {
  const served = existsSync(clientDist)
    ? `serving ${clientDist}`
    : 'dev mode — run `npm run dev:client` for the UI';
  console.log(`Lost Cities server on :${SERVER_PORT} (${served})`);
  for (const address of lanAddresses()) {
    console.log(`  http://${address}:${SERVER_PORT}`);
  }
});

/** Printed so the tablet and phones have an address to type. */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}
