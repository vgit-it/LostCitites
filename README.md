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

The tablet shows a 3-digit room code, plus a QR per open seat — scan it and
the phone lands on the join screen with the code and seat already filled in,
just a name left to type. Typing the code by hand still works too. For a
production run, `npm run build` then `npm start` serves everything from
:3001 on a single port.

```bash
npm test             # unit + integration tests, no I/O
npm run headless     # play a full 3-round match in the terminal
npm run headless -- 12345    # replay a specific seed
npm run typecheck
```

## Deploying for a small group

The LAN mode above needs everyone on the same network. To share a game with
a few friends over the internet instead, host the same server (Express +
`ws` on one port — see `server/index.ts`) somewhere it can stay running:

1. On [render.com](https://render.com), **New → Blueprint**, point it at
   this repo. `render.yaml` at the root defines the whole service — build
   command, start command, TLS — so there is nothing else to configure.
2. Render assigns a `https://<name>.onrender.com` URL and terminates TLS
   for you, which `wss://` (and Wake Lock, which needs a secure context)
   both require. Open that URL's `/table` on the shared device and `/play`
   on each phone, same as the LAN flow — `shared/invite.ts` builds the QR
   and join links from whatever origin the tablet is actually served from,
   so nothing else changes.
3. The free plan spins the service down after ~15 minutes idle and cold-starts
   on the next request — fine between game nights, but a mid-match pause
   longer than that ends the match the same way a server restart does
   (state is in-memory only, per Known limitations below). Render's paid
   Starter tier removes the spin-down if that matters more than the cost.

Any other host that runs a persistent Node process behind TLS works the same
way (Fly.io, Railway, a VPS behind Caddy/nginx) — `render.yaml` is just the
one this repo ships config for. What doesn't work is a serverless/edge
platform: the server holds every room's game state in one process's memory
(`server/registry.ts`), so it needs one long-lived process, not one
invocation per request.

Rooms are never evicted once created — fine for occasional play with a
handful of friends, but worth knowing if this ever stayed up unattended for
a long time.

## The demo

There is a second way to run this that needs no server, no install and no
LAN — it is what gets deployed to GitHub Pages, and it works locally too at
`http://localhost:5173/#/demo`.

| Route | What it is |
|---|---|
| `#/demo` | pick a position and a seed |
| `#/demo/panes` | all three interfaces at once, sharing one match |
| `#/demo/table` | the table, full screen |
| `#/demo/play/0`, `#/demo/play/1` | a phone, full screen |

`?scenario=midround&seed=1234&bot=0` tunes any of them.

**It runs the real server in the browser.** Only `server/index.ts` and
`server/wsTransport.ts` import anything from Node; everything above the
`Connection` seam in `server/transport.ts` is pure TypeScript, so
`registry`, `router`, `room`, `views` and `rules` all run in a tab. The demo
adds two more implementations of that one interface — an in-memory loopback
and a `postMessage` bridge for the panes — and changes nothing else. So the
rules, the validation and the view filtering are the ones that ship, and a
screen in the demo cannot drift from the product the way a fixture would.

A scenario is a **seed and a predicate**, not a saved state: bots play both
seats through the ordinary protocol until the position is reached, then hand
over. That makes a screen a pure function of `(scenario, seed)` — the same
link shows the same cards to whoever you send it to.

Routes live in the hash because a static host has no SPA fallback and is not
guaranteed to sit at the domain root. The demo is a lazily-imported chunk,
so the LAN build never downloads it.

Deployment is in `.github/workflows/pages.yml`: `main` publishes to the site
root and each pull request to `pr-N/`, both on the `gh-pages` branch.

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
                 flights, drawGesture, qrCode, JoinCode
  phone/         Phone, JoinScreen, Hand, FlickZones, HandActions
                 gesture, throw, columnRead, handRows
  shared/        Card (the one card visual, used by both), CardFlight,
                 flightPath, carry, invite, seating
  platform/      vibrate, wakeLock, orientation, motion, sound — the only
                 files touching navigator / screen / Audio
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
| §5 has the server minting the room code, but the views carry no `code` field | The **tablet** generates and persists it, sends it in `joinTable`, and builds the QR join links from its own `window.location` | `client/src/main.tsx`, `client/src/shared/invite.ts` |
| Re-claiming an occupied seat | Replaces the old connection | `server/room.ts` |
| A stale socket closing after a reconnect | Ignored unless it is still the bound one | `server/router.ts` |

## Known limitations

- **Wake Lock needs a secure context.** Over plain `http://192.168.x.x` the
  screens will sleep; tap to wake, or serve over HTTPS (a self-signed cert
  or Tailscale). The vibrate-on-turn cue still fires either way.
- **State is in memory.** Restarting the server ends the match.
- **Placeholder art.** Cards are CSS only, which is deliberate — the art
  swap is confined to `client/src/shared/Card.tsx`.
