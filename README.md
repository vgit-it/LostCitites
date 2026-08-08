# Lost Cities

A two-player, three-device implementation of Reiner Knizia's *Lost Cities*.
One tablet is the shared table; two phones hold the private hands.
LAN-first, personal project. Full specification in
[`reference/BUILD_SPEC.md`](reference/BUILD_SPEC.md).

## Running it

```bash
npm install
npm run dev          # Vite on :5173 + game server on :3001
```

Open the printed LAN address on each device:

| Device | Path |
|---|---|
| Tablet (landscape) | `/table` |
| Each phone (portrait) | `/play` |

The tablet shows a 3-digit room code; the phones type it in. For a
production run, `npm run build` then `npm start` serves everything from
:3001 on a single port.

```bash
npm test             # 124 unit + integration tests, no I/O
npm run headless     # play a full 3-round match in the terminal
npm run headless -- 12345    # replay a specific seed
npm run typecheck
```

## Architecture

The server is authoritative; every client is a renderer. Clients send
intents, the server decides, and each change re-broadcasts the whole
filtered view to all three devices. Phones contain **no rules logic** — the
server ships `legalPlacements` and `legalDrawSources` inside each phone's
view, and the phone greys out anything absent.

```
shared/          types.ts, rules.ts — frozen. Pure, no I/O.
  ▲
server/
  rng            injectable RNG (seeded mulberry32 for tests)
  initialState   lobby-stage GameState, which dealRound has no notion of
  transport      Connection interface — raw strings, no protocol knowledge
  broadcaster    ClientRole + Broadcaster/RoomChannel interfaces (types only)
  views          GameState -> the three filtered views. Pure.
  room           the state machine; mutates only through rules.ts
  registry       room codes and lookup
  router         protocol dispatch
  roomBroadcaster / wsTransport / index    the only files that touch ws
client/src/
  session/       socket -> rejoinStore -> session store -> useSession
  table/         Table, Column, DiscardRow, RoundEnd, ElevationProfile
  phone/         Phone, JoinScreen, Hand, PlaceActions, DrawTargets
  shared/Card    the one card visual, used by both
  platform/      vibrate, wakeLock — the only files touching navigator
```

Two rules hold the structure together:

- **Nothing above `transport.ts` knows about `ws`.** `Room`, `views`,
  `registry` and `router` are all exercised through fakes, which is why the
  entire protocol checklist is testable without opening a socket.
- **No component below `Table.tsx` / `Phone.tsx` knows a server exists.**
  They take plain props, so each renders from a fixture view.

## Decisions the spec left open

The frozen rules layer and the spec disagree or fall silent in a few
places. Each is resolved in exactly one module:

| Gap | Resolution | Where |
|---|---|---|
| No lobby-stage state constructor | `createInitialState()` | `server/initialState.ts` |
| Nothing calls `advanceRound` | Both readies at `roundEnd` | `server/room.ts` |
| `roundOver` / `matchOver` never emitted | Raised on the stage change | `server/room.ts` |
| §5 has the server minting the room code, but the views carry no `code` field | The **tablet** generates and persists it, and sends it in `joinTable` | `client/src/main.tsx` |
| Re-claiming an occupied seat | Replaces the old connection | `server/room.ts` |
| A stale socket closing after a reconnect | Ignored unless it is still the bound one | `server/router.ts` |

## Known limitations

- **Wake Lock needs a secure context.** Over plain `http://192.168.x.x` the
  screens will sleep; tap to wake, or serve over HTTPS (a self-signed cert
  or Tailscale). The vibrate-on-turn cue still fires either way.
- **State is in memory.** Restarting the server ends the match.
- **Placeholder art.** Cards are CSS only, which is deliberate — the art
  swap is confined to `client/src/shared/Card.tsx`.
