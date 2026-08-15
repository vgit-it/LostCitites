# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A two-player, three-device implementation of Reiner Knizia's *Lost Cities*
(Node/Express/`ws` server + React/TypeScript/Vite client). One tablet is the
shared table; two phones, held upright, hold the private hands and
nothing else. LAN-first personal
project — see `reference/BUILD_SPEC.md` for the full design spec (game
rules, protocol, visual direction, art pipeline) and `README.md` for the
condensed architecture summary.

## Commands

```bash
npm install
npm run dev            # Vite dev server (:5173) + game server (:3001), concurrently
npm test                # vitest run — all unit/integration tests, no I/O
npm run test:watch      # vitest watch mode
npm run headless        # play a full 3-round match in the terminal with random legal moves
npm run headless -- 12345   # replay a specific RNG seed
npm run typecheck       # tsc --noEmit
npm run build           # tsc --noEmit && vite build -> dist/client
npm start                # NODE_ENV=production tsx server/index.ts — serves dist/client + ws on :3001
```

Run a single test file: `npx vitest run server/room.test.ts`
Run tests matching a name: `npx vitest run -t "wager"`

There is no separate lint script; `typecheck` and `vitest` are the checks
that matter here.

## Architecture

The server is authoritative; every client is a dumb renderer. Clients send
intents, the server validates and applies them, then re-broadcasts the
**whole** filtered view (no diffing/patching — state is only ~60 cards) to
all three connected roles: `table`, `seat0`, `seat1`.

```
shared/          types.ts, rules.ts — pure, no I/O, frozen game rules
  ▲
server/
  rng            injectable RNG (seeded mulberry32 for deterministic tests)
  initialState   builds the lobby-stage GameState (dealRound has no notion of it)
  transport      Connection interface — raw strings only, no protocol knowledge
  broadcaster    ClientRole + Broadcaster/RoomChannel interfaces (types only)
  views          GameState -> the three role-filtered views. Pure function.
  room           the state machine; mutates state only through shared/rules.ts
  registry       room codes and lookup
  router         protocol dispatch (parses messages, calls room, replies)
  roomBroadcaster / wsTransport / index   the only files that touch `ws` directly
client/src/
  session/       socket -> rejoinStore -> session store -> useSession hook
  table/         Table, Column, DiscardRow, RoundEnd, ElevationProfile
                 flights, drawGesture — cards arriving, and the one reach
                 qrCode, JoinCode — the lobby's per-seat QR
  phone/         Phone, JoinScreen, Hand, FlickZones, HandActions
                 gesture, throw, columnRead — the carry and what it meant
                 handRows — how many cards sit in the hand's first row
  shared/        Card.tsx (the one card visual, used by both), CardFlight,
                 flightPath, carry — the arithmetic of a card in the air
                 invite — the join URL, written by the tablet and read by the phone
  platform/      vibrate, wakeLock, orientation, motion — the only files
                 touching `navigator` / `screen`
  demo/          the server, running in the browser (see below)
```

Two rules hold the structure together — preserve them when changing code:

- **Nothing above `server/transport.ts` knows about `ws`.** `Room`,
  `views`, `registry`, and `router` are all exercised through fakes
  (`server/testDoubles.ts`), which is why the whole protocol is testable
  without opening a real socket.
- **No component below `Table.tsx` / `Phone.tsx` knows a server exists.**
  They take plain props and render from fixture views — no rules logic
  lives on the client. The server ships `legalPlacements` inside each
  phone's view and `legalDrawSources` inside all three; the phone only
  mutes what's absent from the first, and the table only arms what's
  present in the second.

### The demo (`client/src/demo/`)

A server-free build for GitHub Pages, at `#/demo`. It is the one place a
client file imports `server/`, and it earns that: because nothing above
`server/transport.ts` imports Node, the whole server runs in a tab, so the
demo uses the **real** `Room`, `rules.ts` and `views.ts` rather than
fixtures that would drift.

Both structural rules above still hold. `demo/` sits *above*
`Table.tsx`/`Phone.tsx` and feeds them through the ordinary
`SessionProvider`, so no component below those two learns a server exists.

- `loopback.ts`, `bridge.ts` — two more `Connection` implementations
  alongside `wsTransport.ts`. Loopback delivery is **deferred by default**;
  `{ sync: true }` is only for the scenario fast-forward.
- `bot.ts` — a *client*, not a server plugin: it plays from
  `legalPlacements` / `legalDrawSources` on its own `PlayerView`. Drive it
  with `pump()`, never from inside its own message handler.
- `scenarios.ts` — a seed plus a predicate, played to through the protocol.
  Never hand-build a `GameState`, and never add a server API for the demo's
  benefit.
- `route.ts` — imported **eagerly** by `main.tsx`, so it must stay free of
  value imports from the rest of `demo/`, or the code split collapses and
  the whole server lands in the main bundle.

If the demo ever seems to need a change to `server/` or `shared/`, that is a
finding worth reporting, not a patch to make quietly.

### State model

`GameState` (server-only truth, never sent to clients as-is) holds the
deck, discards, both `PlayerState`s (hand, expeditions, round scores),
whose turn it is, `phase: 'place' | 'draw'`, and `blockedDrawCardId` — the
single mechanism enforcing "you can't draw back the card you just
discarded" (set on discard, cleared on any draw/placement).

`views.ts` derives two wire shapes from it: `TableView` (deck count,
discard tops, both expeditions, hand *counts* only, scores) and
`PlayerView` (TableView plus own `hand`, `legalPlacements`,
`legalDrawSources`). Never leak the deck or the opponent's hand into any
view — `server/views.test.ts` guards this.

Every card has a stable id (`"blue-7"`, `"blue-w1"`); all client intents
reference cards by id, never index, so client-side reordering is safe.

### Protocol

WebSocket, JSON, `t` field as discriminator. Client → server:
`joinTable`, `joinPlayer`, `startRound`, `place`, `draw`, `readyNextRound`.
Server → client: `state` (full filtered view, sent after every change),
`error`, `event` (cosmetic animation cue only — **never derive state from
an `event`**; the next `state` message is always the source of truth).

### Scoring (shared/rules.ts)

The scoring formula is the whole design surface of the game and the
easiest place to introduce subtle bugs — see `reference/BUILD_SPEC.md` §2.5
and §17 before changing it. Key edge cases already covered by
`shared/rules.test.ts`: an empty column scores 0 (not −20); wagers
multiply losses as well as gains; the 8-card bonus counts wagers toward
the threshold and is added *after* the multiplier.

### Gaps the spec left open

A few places where `reference/BUILD_SPEC.md` and the frozen rules layer
disagree or fall silent — each resolved in exactly one module, don't
re-litigate elsewhere:

| Gap | Resolution | Where |
|---|---|---|
| No lobby-stage state constructor | `createInitialState()` | `server/initialState.ts` |
| Nothing calls `advanceRound` | Both readies at `roundEnd` | `server/room.ts` |
| `roundOver` / `matchOver` never emitted | Raised on the stage change | `server/room.ts` |
| Views carry no `code` field | The **tablet** generates/persists it, sends via `joinTable`, and builds the QR join links from its own `window.location` | `client/src/main.tsx`, `client/src/shared/invite.ts` |
| Re-claiming an occupied seat | Replaces the old connection | `server/room.ts` |
| A stale socket closing after reconnect | Ignored unless still the bound one | `server/router.ts` |
| The table has no seat, but draws | `drawFromTable` resolves it from the turn | `server/room.ts` |

### Where the interaction lives

The phone is a hand of cards and nothing else; the table is where you draw.
Both departed from `reference/BUILD_SPEC.md`, and the spec has been updated
rather than left to disagree — §7 for the table's one gesture and its
aligned board, §8 for the portrait phone and the carry-and-throw model.

- **The table is still tap-free.** `drawGesture.ts` explains why a
  directional pull during a draw phase is safe where a tap was not, and it
  is the only input the shared display accepts.
- **Gesture arithmetic is pure and tested alone**, the way `columnMetrics`
  is: `shared/carry.ts` (the follow, the tilt, the velocity),
  `phone/throw.ts` (which direction meant what), `table/drawGesture.ts`
  (whether a pull was toward the right seat). The components own the
  pointer events and the animation frame, and compute nothing.
- **Flights are cosmetic and diff-free.** `table/flights.ts` turns a
  `TableEvent` into a journey, using the view as it stood *before* the cue —
  the server emits its event and then broadcasts, so a card taken off a
  discard pile only still exists in the previous view.

## Known limitations

- Wake Lock needs a secure context; over plain `http://192.168.x.x` screens
  can sleep (vibrate-on-turn still fires).
- State is in-memory only — restarting the server ends the match.
- Card art is CSS-only by design; any art swap is confined to
  `client/src/shared/Card.tsx`.
