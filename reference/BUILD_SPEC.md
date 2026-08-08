# Lost Cities — Multi-Device Web Build Spec

A two-player, three-device implementation of Reiner Knizia's *Lost Cities*.
One tablet acts as the shared table. Two phones hold private hands.
Personal project, LAN-first, no public release.

---

## Contents

1. [Scope and constraints](#1-scope-and-constraints)
2. [Game rules — complete reference](#2-game-rules--complete-reference)
3. [Architecture](#3-architecture)
4. [State model](#4-state-model)
5. [Protocol](#5-protocol)
6. [Server implementation](#6-server-implementation)
7. [Table client](#7-table-client)
8. [Phone client](#8-phone-client)
9. [Visual design direction](#9-visual-design-direction)
10. [Asset manifest and placeholders](#10-asset-manifest-and-placeholders)
11. [Image generation prompts](#11-image-generation-prompts)
12. [Reconnection and failure handling](#12-reconnection-and-failure-handling)
13. [Project structure](#13-project-structure)
14. [Build milestones](#14-build-milestones)
15. [Testing checklist](#15-testing-checklist)
16. [Hosting](#16-hosting)
17. [Modification vectors](#17-modification-vectors)

---

## 1. Scope and constraints

**In scope**
- Exactly 2 players, 3 rounds, standard rules.
- One shared table display (tablet, landscape).
- Two phone controllers (portrait).
- Single room at a time. 3-digit join code.
- Local network hosting.

**Out of scope for v1**
- AI opponent
- Spectators
- Persistence across server restart
- Accounts, matchmaking, chat
- Anti-cheat hardening

**Design consequences of "personal project"**
- Server validation exists to catch bugs, not attackers.
- In-memory state only. No database.
- No build pipeline beyond Vite.
- Placeholder art is acceptable for the entire first playable build.

---

## 2. Game rules — complete reference

### 2.1 Deck

60 cards. Five colours. Per colour:

| Type | Count | Values |
|---|---|---|
| Expedition (number) | 9 | 2, 3, 4, 5, 6, 7, 8, 9, 10 |
| Wager | 3 | no value |

Total per colour: 12. Total deck: 60.

**Colours** (thematic, from the original):

| Key | Expedition | Suggested hue |
|---|---|---|
| `yellow` | Desert Sands | warm ochre |
| `blue` | Neptune's Realm | deep teal-blue |
| `white` | The Himalayas | pale grey-white |
| `green` | Brazilian Rain Forest | deep jungle green |
| `red` | Ancient Volcanos | rust red |

There is **no 1 card**. The lowest number is 2.

### 2.2 Setup

- Shuffle all 60 cards.
- Deal 8 to each player, face down.
- Remaining 44 cards form the draw pile.
- Five discard piles start empty, one per colour.

### 2.3 Turn structure

Every turn is exactly two mandatory steps, in this order. There is no skipping either.

**Step 1 — Place one card**

Choose one option:

*(a) Play to your own expedition column*
- Only your own side. You never touch the opponent's columns.
- Card goes into the column matching its own colour. You cannot cross colours.
- A **number card** must be strictly higher than the last number card in that column.
- A **wager card** may only be played while the column contains no number cards. Multiple wagers may stack. Once any number card is placed, no further wagers of that colour are legal.
- Cards are appended; nothing can be reordered or removed.

*(b) Discard*
- Place face up on the discard pile of that card's own colour.
- Only the top card of each pile is visible.
- Always legal for any card in hand.

**Step 2 — Draw one card**

Choose one source:
- Top of the draw pile.
- Top of any non-empty discard pile (either player's discards — the piles are shared).

**Restriction:** you may not draw the exact card you just discarded this turn.

Turn ends. Hand returns to 8.

### 2.4 Round end

The round ends **immediately** when a player draws the last card from the draw pile. That player keeps the drawn card and does not take another turn. The opponent does not get a compensating turn.

Draw pile count should be permanently visible on the table display. (The physical rules allow players to fan and count near the end; showing it always is the clean digital equivalent.)

### 2.5 Scoring

Score each of the five columns separately, then sum.

```
if column is empty:
    score = 0                      // no penalty for never starting a colour
else:
    sum        = total of number card face values
    subtotal   = sum - 20          // expedition cost
    multiplier = 1 + wagerCount    // 1 wager = x2, 2 = x3, 3 = x4
    score      = subtotal * multiplier
    if column.length >= 8:         // wagers COUNT toward this
        score += 20                // bonus applied AFTER multiplier
```

Critical edge cases, all commonly implemented wrong:

- An untouched colour scores **0**, not −20.
- Wagers **multiply losses** identically to gains. A single wager on a weak column doubles the damage.
- The 8-card bonus counts **wagers plus numbers**, so 2 wagers + 6 numbers qualifies.
- The bonus is added **after** the multiplier, never multiplied by it.
- A wager-only column (no numbers) scores `(0 − 20) × multiplier`. Legal, and very bad.

**Reference values:**
- Empty → `0`
- Single 2 → `-18`
- Max column (3 wagers + 2..10) → `(54−20)×4 + 20 = 156`
- 2 wagers + 2,3,4,5,6,7 → `(27−20)×3 + 20 = 41`

### 2.6 Match structure

Three rounds. Reshuffle and re-deal between each. Record cumulative scores. Highest total after round 3 wins.

The player with the higher score in a round leads the next round. On a tie, the previous leader keeps it.

---

## 3. Architecture

```
                    ┌──────────────────┐
                    │   Node server    │
                    │  (authoritative) │
                    │  in-memory room  │
                    └────────┬─────────┘
                             │ WebSocket
              ┌──────────────┼──────────────┐
              │              │              │
      ┌───────▼──────┐ ┌─────▼─────┐ ┌──────▼───────┐
      │ Tablet       │ │ Phone A   │ │ Phone B      │
      │ /table       │ │ /play     │ │ /play        │
      │ read-only    │ │ seat 0    │ │ seat 1       │
      └──────────────┘ └───────────┘ └──────────────┘
```

**Principles**

1. **Server-authoritative.** Every client is a dumb renderer. Clients send intents; the server decides.
2. **The tablet is not the host.** It's just another client. If it were the host, backgrounding the browser tab would kill the game.
3. **Full-state broadcast.** State is ~60 cards. No diffing, no patches. Every change re-broadcasts the whole filtered view to all three clients.
4. **Role-filtered views.** The server builds one truth object, then strips it per recipient. The tablet receives no hands. Each phone receives only its own.
5. **Phones contain zero rules logic.** The server precomputes legal moves and ships them inside the phone's view. The phone greys out anything not in the list.

---

## 4. State model

Use the `types.ts` and `rules.ts` files already produced. Summary:

### Server-only truth

```ts
GameState {
  round: 1 | 2 | 3
  stage: 'lobby' | 'playing' | 'roundEnd' | 'matchEnd'
  deck: Card[]
  discards: Record<Colour, Card[]>
  players: [PlayerState, PlayerState]
  turn: Seat                     // 0 | 1
  phase: 'place' | 'draw'
  blockedDrawCardId: string|null // the just-discarded card
  readyForNextRound: [boolean, boolean]
}

PlayerState {
  seat, name, connected
  hand: Card[]
  expeditions: Record<Colour, Card[]>
  roundScores: number[]
}
```

### Wire views

`TableView` — deck count, discard tops, both players' expeditions, hand **counts** only, scores, turn, phase.

`PlayerView` — everything in TableView, plus own `hand`, plus `legalPlacements` (cardId → allowed targets) and `legalDrawSources`.

The `blockedDrawCardId` field is the single mechanism enforcing the no-take-back rule. Set on discard, cleared on any draw and on any expedition placement.

### Card identity

Every card needs a stable unique id: `"blue-7"`, `"blue-w1"`. All client intents reference cards by id, never by index. This survives hand reordering on the client.

---

## 5. Protocol

WebSocket, JSON messages, `t` field as discriminator.

### Client → Server

| Message | Payload | Notes |
|---|---|---|
| `joinTable` | `{ code }` | Tablet claims table role |
| `joinPlayer` | `{ code, seat, name }` | Phone claims a seat |
| `startRound` | — | Any client, from lobby |
| `place` | `{ cardId, target }` | `target: 'expedition' \| 'discard'` |
| `draw` | `{ source }` | `{kind:'deck'}` or `{kind:'discard', colour}` |
| `readyNextRound` | — | Advances past round-end screen |

### Server → Client

| Message | Payload |
|---|---|
| `state` | `{ view }` — full filtered view, sent after every change |
| `error` | `{ message }` — human-readable, shown as a toast |
| `event` | `{ kind }` — animation cue only, never state-bearing |

### Table events (animation cues)

```ts
{ name: 'placed', seat, card, target }
{ name: 'drew',   seat, source }
{ name: 'roundOver' }
{ name: 'matchOver', winner }
```

Events exist so the tablet can animate a card flying into a column. They are cosmetic. If one is dropped, the next `state` still corrects the display. **Never derive state from events.**

### Room code

3 digits, `100`–`999`. Generated by the server when the tablet first connects. Displayed large on the tablet. Phones type it.

Do not use `0` as a leading digit — avoids ambiguity when someone reads it aloud.

---

## 6. Server implementation

### Responsibilities

- Own the deck and the RNG. Never send the deck to any client.
- Validate every intent (`validatePlace`, `validateDraw` from `rules.ts`).
- Apply the mutation.
- Rebuild and broadcast three filtered views.
- Track socket → role mapping (`table`, `seat0`, `seat1`).

### Core loop

```
onMessage(socket, msg):
  role = roleOf(socket)
  switch msg.t:
    case 'place':
      v = validatePlace(state, role.seat, msg.cardId, msg.target)
      if !v.ok: return send(socket, error(v.reason))
      card = applyPlace(...)
      emit({name:'placed', ...})
      broadcast()

    case 'draw':
      v = validateDraw(state, role.seat, msg.source)
      if !v.ok: return send(socket, error(v.reason))
      applyDraw(...)                  // may end the round internally
      emit({name:'drew', ...})
      if state.stage !== 'playing': emit({name:'roundOver'})
      broadcast()
```

### View filtering

```
broadcast():
  send(tableSocket, state({viewer:'table', ...base}))
  send(seat0Socket, state({viewer:'player', seat:0, hand:..., legal...}))
  send(seat1Socket, state({viewer:'player', seat:1, hand:..., legal...}))
```

Build `base` once. Never include `deck` contents or the opponent's `hand` array in any view.

### Serving the client

One Express (or plain `http`) server serves the built Vite output and upgrades to WebSocket on the same port. Single URL for all three devices.

Routes:
- `/` → role picker ("This is the table" / "I'm a player")
- `/table` → table client
- `/play` → phone client

---

## 7. Table client

Landscape, tablet, viewed from ~1 metre. **Readability at distance is the primary constraint.**

### Layout

```
┌───────────────────────────────────────────────────────┐
│  ROUND 2/3        ● Paul  42        ○ Aditi  −11      │  status bar
├───────────────────────────────────────────────────────┤
│                                                       │
│   [Y]  [B]  [W]  [G]  [R]      ← opponent columns     │
│    9    –    7    –    4          (grow upward)       │
│    6         5         2                              │
│                                                       │
├───────────────────────────────────────────────────────┤
│   ┌──┐  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐                     │
│   │44│  │ Y│ │ B│ │ W│ │ G│ │ R│    ← deck + discards │
│   └──┘  └──┘ └──┘ └──┘ └──┘ └──┘                     │
├───────────────────────────────────────────────────────┤
│                                                       │
│    3    –    2    4    –       ← your columns         │
│    7         8    9               (grow downward)     │
│   [Y]  [B]  [W]  [G]  [R]                             │
│                                                       │
├───────────────────────────────────────────────────────┤
│  Paul's turn — placing a card              8 cards ●● │  turn bar
└───────────────────────────────────────────────────────┘
```

### Requirements

- **Card numerals minimum 32px** at tablet size. Colour alone is insufficient; every card shows its number.
- **Columns overlap vertically** with ~35% of each card visible — enough to read the number.
- **Draw pile count always visible.** Turns amber below 10, red below 5.
- **Turn indicator unmissable.** Whose turn, and which phase (`placing` vs `drawing`). A subtle glow on the active player's side is not enough — use an explicit text line.
- **Live round score** per player, recomputed each broadcast. Optional but very useful for pacing decisions.
- **No input.** The table is read-only. No taps do anything. This prevents accidental state changes when someone leans on the tablet.
- **Keep screen awake.** Wake Lock API, with a fallback of a looping invisible video element if running over plain HTTP.

### Screens

| Stage | Display |
|---|---|
| `lobby` | Huge 3-digit code, seat slots showing connected/waiting |
| `playing` | Main board above |
| `roundEnd` | Per-colour score breakdown, both players side by side |
| `matchEnd` | Three-round table, winner announcement |

### Round-end breakdown

Show the arithmetic, not just totals. People want to see why they lost.

```
BLUE     2 + 5 + 9 = 16   − 20 = −4    ×2 (1 wager)  = −8
GREEN    4+6+7+8+10 = 35  − 20 = 15    ×1            = 15
WHITE    —                                            = 0
```

---

## 8. Phone client

Portrait. One thumb. The player is looking up at the table most of the time, so the phone must be glanceable.

### Layout

```
┌─────────────────────┐
│ Your turn — place   │  ← state banner, colour-coded
│ Deck: 44            │
├─────────────────────┤
│                     │
│   [selected card    │
│    enlarged preview]│  ← only when a card is tapped
│                     │
│  ┌────────┐┌───────┐│
│  │ Play to││Discard││  ← action buttons appear on select
│  │  BLUE  ││       ││
│  └────────┘└───────┘│
├─────────────────────┤
│ ┌─┐┌─┐┌─┐┌─┐┌─┐┌─┐  │
│ │2││5││W││9││3││7│  │  ← hand, horizontally scrollable
│ └─┘└─┘└─┘└─┘└─┘└─┘  │     or 2 rows of 4
└─────────────────────┘
```

### Interaction model

**Place phase**
1. Tap a card in hand → it enlarges, action buttons appear.
2. Illegal targets are greyed with a reason ("must beat 7").
3. Tap "Play to BLUE" or "Discard" → sent to server.
4. Buttons disable until the next state arrives.

**Draw phase**
The hand area is replaced by six draw targets:

```
┌────────────────────────┐
│  Draw a card           │
│  ┌────┐                │
│  │DECK│  44 left       │
│  └────┘                │
│  ┌──┐┌──┐┌──┐┌──┐┌──┐  │
│  │Y6││B–││W2││G9││R–│  │
│  └──┘└──┘└──┘└──┘└──┘  │
│   the card you just    │
│   discarded is locked  │
└────────────────────────┘
```

Empty piles and the blocked card are greyed and non-tappable.

### Requirements

- **Buzz on turn start.** `navigator.vibrate(200)` when the view flips to your turn. This is the single highest-value quality-of-life feature — phones sleep during the opponent's turn.
- **Confirmation on destructive plays.** Optional but recommended: playing a 10 into a column you can never extend is a common misclick. A double-tap-to-confirm on high cards is worth considering.
- **No rules logic on the client.** Use `legalPlacements` and `legalDrawSources` from the view.
- **Sort hand by colour then value** by default. Add a toggle for draw order if you want.
- **Waiting state must be calm.** When it's not your turn, show the opponent's last action and nothing tappable. Don't show a spinner — it implies something is broken.

### Copy guidance

Buttons name what happens: "Play to Blue", not "Confirm". The toast after says "Played blue 7". Same vocabulary throughout.

Errors state the problem and the fix: "Blue 4 is too low — the column is at 7." Not "Invalid move."

Empty draw pile: "Last card taken. Round over." Not an error state.

---

## 9. Visual design direction

The subject is 1920s–30s expedition archaeology. The vernacular to mine: field journals, survey stamps, tinted map plates, luggage labels, brass instrument dials.

### Direction: Field Survey

Not a fantasy-adventure look. Not parchment-and-gold. The reference is a **cartographic survey document** — precise, technical, restrained, with colour used as classification rather than decoration.

**Palette**

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#E8E3D6` | table background, card faces |
| `--ink` | `#1F1D1A` | all type |
| `--rule` | `#B4AC98` | hairlines, column guides |
| `--sand` | `#C9922E` | Desert Sands |
| `--deep` | `#1F5E75` | Neptune's Realm |
| `--summit` | `#8B9199` | The Himalayas |
| `--canopy` | `#2C5F3E` | Rain Forest |
| `--magma` | `#A33B26` | Ancient Volcanos |

The five expedition colours are the entire chromatic budget. Everything structural is paper, ink, and rule. This means a card reads as its colour instantly at a distance, because nothing else on screen competes.

**Typography**

- **Numerals:** a condensed grotesque with real weight — the number is the functional payload and must dominate. Consider *Oswald*, *Archivo Narrow*, or *Barlow Condensed*. Set very large, tight tracking.
- **Labels and UI:** a mono or engineered sans for the survey feel — *IBM Plex Mono* or *Space Mono*, small, wide-tracked, uppercase.
- Avoid: display serifs, hand-lettered scripts, anything that reads "adventure movie poster."

**Signature element**

Each expedition column, as it grows, draws a **surveyor's elevation profile** down its left edge — a thin stepped line whose height maps to the card values played. A strong ascending expedition literally draws a rising ridge line. A stalled one shows a flat stub. From across the table you read the shape before you read the numbers.

This is one idea, spent in one place. Everything else stays quiet.

**Motion**

- Card placement: 180ms translate + settle. Nothing bouncy.
- Score reveal at round end: columns tally sequentially, ~250ms apart. This is the one moment worth choreographing.
- No ambient animation. No parallax. No particles.

**Accessibility floor**

- Every card shows its number. Colour is never the only channel.
- Add a subtle per-colour pattern to card corners (dots, stripes, cross-hatch) if any player is colourblind.
- Respect `prefers-reduced-motion`.

---

## 10. Asset manifest and placeholders

### Placeholder-first policy

**Build the entire game with CSS-only placeholder cards.** Do not generate a single image until the game is fully playable end to end. Art is the last 10% and the easiest to swap.

A placeholder card is a rounded rect with a background colour and a large numeral:

```css
.card {
  aspect-ratio: 2 / 3;
  border-radius: 4px;
  background: var(--colour);
  color: var(--paper);
  font: 700 clamp(20px, 5vw, 48px)/1 'Barlow Condensed', sans-serif;
  display: grid;
  place-items: center;
}
.card--wager::after { content: '✦'; }
```

That is genuinely sufficient to play. Everything below is polish.

### Full asset list

| # | Asset | Count | Format | Size | Priority |
|---|---|---|---|---|---|
| 1 | Expedition card faces | 45 (or 5 backgrounds) | SVG/PNG | 400×600 | Low |
| 2 | Wager card faces | 5 (one per colour) | SVG/PNG | 400×600 | Low |
| 3 | Card back | 1 | SVG/PNG | 400×600 | Medium |
| 4 | Expedition colour icons | 5 | SVG | 128×128 | Medium |
| 5 | Table background texture | 1 | JPG/WebP | 2560×1600 | Low |
| 6 | Discard pile slot markers | 5 | SVG | 200×300 | Low |
| 7 | Round-end stamp | 1 | SVG/PNG | 512×512 | Low |
| 8 | App icon / favicon | 1 | PNG | 512×512 | Low |
| 9 | Winner seal | 1 | PNG | 800×800 | Low |

**Efficiency note:** you do **not** need 45 unique card faces. Generate **5 colour background plates** and composite the numeral in CSS on top. This drops the job from 45 images to 5, and keeps numerals crisp at any size. Do the same for wagers.

Recommended minimum viable art set: **assets 2, 3, and 4** (11 images total). Everything else can stay CSS.

---

## 11. Image generation prompts

All prompts assume a text-to-image model. Append your model's usual quality modifiers. Each prompt specifies **no text and no numbers** — numerals are composited in CSS so they stay sharp and correct.

### 11.1 Expedition card background plates (5 images)

Generate one per colour. Vertical 2:3. These sit *behind* the CSS numeral, so the centre must stay visually quiet.

**Shared prompt skeleton:**

> Vertical playing card background, 2:3 ratio, 1920s cartographic survey plate aesthetic. [SCENE]. Rendered as a two-tone tinted lithograph in [COLOUR] on aged off-white paper. Fine engraved hatching, subtle contour lines, visible paper grain. Composition is dark and detailed at the top and bottom edges, fading to near-empty pale space across the central third. Flat, printed, matte. No text, no numbers, no letters, no border frame, no people.

**Per-colour scene and colour:**

| Colour | `[SCENE]` | `[COLOUR]` |
|---|---|---|
| Desert Sands | wind-carved dune ridges and a half-buried stone lintel | warm ochre gold |
| Neptune's Realm | a submerged colonnade with kelp and depth-sounding marks | deep teal blue |
| Himalayas | layered ridgelines and a glacial saddle with survey triangulation marks | cool pale slate grey |
| Rain Forest | dense canopy silhouettes over a stepped stone platform | deep jungle green |
| Ancient Volcanos | a caldera rim with ash strata and lava flow contours | rust red |

### 11.2 Wager card faces (5 images)

Wagers have no numeral, so these can be fully detailed.

> Vertical playing card face, 2:3 ratio, 1920s expedition finance document aesthetic. Central motif: two hands clasped in an agreement, rendered as an engraved seal within a surveyor's compass rose. Two-tone tinted lithograph in [COLOUR] on aged off-white paper. Fine engraved linework, subtle guilloche border pattern, visible paper grain. Symmetrical, centred composition. Flat, printed, matte. No text, no numbers, no letters.

Substitute the same five colours as above.

### 11.3 Card back (1 image)

> Vertical playing card back, 2:3 ratio, 1920s field survey document aesthetic. A repeating geometric pattern of interlocking surveyor's triangulation networks and fine contour lines, rendered in muted olive and warm grey on aged off-white paper. Dense, symmetrical, edge-to-edge tiling with a thin double-rule border inset. Engraved lithograph texture with visible paper grain. Flat, printed, matte. No text, no numbers, no letters, no central emblem.

### 11.4 Expedition icons (5 images)

Small, used in discard slots, score panels, and phone action buttons. Must read at 24px.

> Minimal pictogram icon, single colour [COLOUR] on transparent background, engraved woodcut style with thick confident strokes. Subject: [ICON]. Extremely simplified, high contrast, symmetrical, readable at very small size. Flat vector look, no gradients, no shading, no text, no frame.

| Colour | `[ICON]` |
|---|---|
| Desert Sands | a single dune curve with a small obelisk |
| Neptune's Realm | a trident crossed with a wave line |
| Himalayas | a triangular peak with a summit flag |
| Rain Forest | a single broad leaf over a stepped pyramid |
| Ancient Volcanos | a volcano cone with three ash plumes |

### 11.5 Table background texture (1 image)

> Seamless horizontal background texture, aged off-white surveyor's paper, 1920s field atlas. Faint blue-grey grid ruling, extremely subtle coffee staining at the far edges, visible fibrous paper grain, soft uneven vignetting. Very low contrast — this is a background and must not compete with foreground elements. No text, no numbers, no illustrations, no objects, no borders.

Keep this at very low contrast. If it's noticeable, it's too strong. Consider skipping it entirely — flat `--paper` may read better on a tablet.

### 11.6 Discard slot markers (5 images)

> Empty card slot marker, vertical 2:3 ratio. A thin dashed rectangular outline in muted [COLOUR] on transparent background, with a small centred engraved pictogram of [ICON] at 25 percent opacity. Minimal, flat, technical drawing style. No text, no numbers, no fill.

Reuse the icons from 11.4.

### 11.7 Round-end stamp (1 image)

> Circular rubber stamp impression, 1920s expedition archive. Concentric double ring with radial tick marks between them, a small compass rose at the centre. Rendered in faded oxblood red ink with authentic uneven coverage, ink bleed, and missing patches at the edges. Transparent background, slightly rotated off-axis. No text, no numbers, no letters.

### 11.8 Winner seal (1 image)

> Ornate wax seal impression viewed straight on, deep oxblood red wax with visible pooling and irregular edges. Embossed into the wax: a surveyor's theodolite crossed with a palm frond. Soft raking light from the upper left, subtle surface sheen, fine wax texture. Transparent background. No text, no numbers, no letters, no ribbon.

### 11.9 App icon (1 image)

> App icon, square, 1920s expedition survey aesthetic. A single stylised triangulation marker — three thin lines converging on a solid dot — in ochre and deep teal on aged off-white paper. Centred, extremely minimal, strong silhouette that reads at 32 pixels. Flat, printed, matte texture. No text, no numbers, no letters, no rounded frame.

### General generation notes

- **Always specify "no text, no numbers, no letters."** Image models hallucinate garbled text onto cards relentlessly.
- Generate the five colour plates **in one session with consistent phrasing**, so they share a visual family. Regenerating one months later will not match.
- If a plate's centre is too busy, add "the central third is nearly empty pale paper" and regenerate.
- Export card art at 2× intended display size. A card rendered at 200×300 CSS pixels needs a 400×600 source.
- Prefer SVG for icons and slot markers. Raster only for the plates and seals.

---

## 12. Reconnection and failure handling

The single most common real-world failure: a phone sleeps mid-game.

### Server behaviour

- Never destroy a room on disconnect. Mark `player.connected = false` and broadcast.
- Keep the room alive indefinitely. You'll restart the process manually when done.
- On reconnect, the phone re-sends `joinPlayer` with the same seat. Server rebinds the socket and sends full state.
- Turn state is untouched by disconnection. If it was your turn in `draw` phase, it still is when you come back.

### Client behaviour

- Store `{ code, seat, name }` in `localStorage` on successful join.
- On load, if that exists, auto-rejoin without showing the join screen.
- Auto-reconnect the WebSocket with a fixed 1s retry. No exponential backoff — this is a LAN.
- Show a thin "reconnecting" bar, not a blocking modal.

### Table behaviour

- Show a small indicator per seat: connected / waiting.
- Never block the board on a disconnect. The state is still valid and readable.

### Mid-turn safety

Because `phase` lives on the server, a disconnect between placing and drawing resumes correctly. This is the reason phase is server state and not a client-side UI flag.

### Screen sleep

- Request Wake Lock on both table and phone.
- **Wake Lock requires a secure context.** Over plain `http://192.168.x.x` it will not work. Options: accept it and tap the screen, use a self-signed cert, or use Tailscale (which gives you HTTPS-capable hostnames).
- The vibrate-on-turn cue partially compensates — the phone buzzes even if the screen is off.

---

## 13. Project structure

```
lost-cities/
├── package.json
├── shared/
│   ├── types.ts          # already written
│   └── rules.ts          # already written
├── server/
│   ├── index.ts          # http + ws, serves client build
│   ├── room.ts           # room object, socket→role map
│   └── views.ts          # state filtering
├── client/
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx      # role router: / /table /play
│   │   ├── socket.ts     # ws connection + reconnect
│   │   ├── table/
│   │   │   ├── Table.tsx
│   │   │   ├── Column.tsx
│   │   │   ├── DiscardRow.tsx
│   │   │   └── RoundEnd.tsx
│   │   ├── phone/
│   │   │   ├── Phone.tsx
│   │   │   ├── Hand.tsx
│   │   │   ├── PlaceActions.tsx
│   │   │   └── DrawTargets.tsx
│   │   ├── shared/
│   │   │   └── Card.tsx  # used by both, size-parameterised
│   │   └── styles/
│   │       └── tokens.css
│   └── public/assets/    # generated art goes here, last
└── vite.config.ts
```

**Stack:** Node + `ws` + Express, React + TypeScript + Vite. Shared types imported directly by both sides via a path alias — no separate package needed.

---

## 14. Build milestones

Sequenced so you have something playable as early as possible.

**M1 — Rules engine** ✅ *done*
`types.ts` and `rules.ts` with passing tests.

**M2 — Headless game loop**
A Node script that plays a full 3-round game with random legal moves and prints final scores. No UI, no sockets. Proves the rules layer end to end and catches round-transition bugs early.

**M3 — Server + protocol**
Room object, socket handling, view filtering. Test with a WebSocket CLI client. Verify hands never leak into the table view.

**M4 — Table client, placeholder art**
Full board rendering from `TableView`. CSS cards only. Read-only.

**M5 — Phone client, placeholder art**
Hand, place actions, draw targets. Full game now playable across three devices.

**M6 — Round and match flow**
Round-end breakdown screen, ready gate, re-deal, match-end summary.

**M7 — Resilience**
Reconnect, localStorage rejoin, vibrate-on-turn, wake lock, connection indicators.

**M8 — Visual pass**
Design tokens, typography, the elevation-profile signature element, motion.

**M9 — Art**
Generate the 11 core images. Swap in behind the existing CSS card component — should be a one-file change if `Card.tsx` was built cleanly.

**M10 — Modifications**
Your own rules changes. See section 17.

Play the game with friends at M5. Do not wait for art.

---

## 15. Testing checklist

### Rules

- [ ] Deck is exactly 60 cards, 60 unique ids, 15 wagers
- [ ] Empty column scores 0, not −20
- [ ] Wager doubles a negative column
- [ ] 8-card bonus counts wagers toward the threshold
- [ ] Bonus is added after the multiplier, not before
- [ ] Wager rejected once a number card is in the column
- [ ] Equal or lower number rejected
- [ ] Card cannot be played to a different colour's column
- [ ] Round ends immediately on last deck draw; no extra turn
- [ ] Higher round scorer leads the next round

### Protocol

- [ ] Table view contains no `hand` arrays
- [ ] Phone view contains no opponent hand, no deck contents
- [ ] Placing out of turn is rejected
- [ ] Drawing before placing is rejected
- [ ] Placing twice in a turn is rejected
- [ ] Just-discarded card is not in `legalDrawSources`
- [ ] Empty discard pile is not in `legalDrawSources`

### Devices

- [ ] Phone sleeps and reconnects mid-turn, resumes at correct phase
- [ ] Table refresh restores full board
- [ ] Both phones refresh simultaneously, both recover
- [ ] Card numerals legible on the tablet from 1 metre
- [ ] Vibrate fires on turn start
- [ ] Round-end screen requires both readies before dealing

---

## 16. Hosting

| Option | When | Effort |
|---|---|---|
| **Laptop on home wifi** | Everyone in the room. Development. | None. `node server` and share `192.168.x.x:5173` |
| **Tailscale** | Friends remote, you host | Install on each device, join network, stable hostname |
| **Railway / Render / Fly** | Friends remote, easiest for them | Push to GitHub, connect repo, get a URL |

GitHub Pages will **not** work — it serves static files only, and this needs a persistent WebSocket process.

**Recommendation:** develop on option 1. It's the tightest iteration loop. Move to option 3 only if you actually need remote play.

Note that free cloud tiers sleep after inactivity. A ~10 second cold start before a game is fine; there is no mid-game risk because the socket keeps the process warm.

---

## 17. Modification vectors

The scoring formula is the entire design surface of this game. Everything interesting you can do lives there or in the draw rules.

**Low risk, high effect**
- Change the expedition cost from 20. Lower makes players start more colours; higher makes the game tighter and meaner.
- Change the bonus threshold or value.
- Per-colour costs — make one expedition expensive and lucrative.

**Medium**
- Add value 1 cards, or extend to 12.
- Change wager multipliers to additive bonuses instead — removes the loss-amplification tension entirely, which changes the game's whole risk character.
- Let players discard *two* cards on a turn at some cost.

**High — changes the game's identity**
- Direct interaction. The original has **zero** — you cannot touch an opponent's columns. Adding any sabotage mechanic makes it a different game. Worth trying, but know what you're giving up: the current design's tension comes from shared scarcity, not conflict.
- Simultaneous turns.
- A third player. Semi-official 3–4 player variants exist; the discard-pile scarcity dynamic shifts substantially.

Build the base game first, play it several times, then modify. You need the baseline feel before you can tell whether a change improved anything.
