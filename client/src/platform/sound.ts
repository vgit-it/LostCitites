// ============================================================
// Sound effects, isolated so components never construct an Audio element
// directly — same reason vibrate.ts and wakeLock.ts exist.
//
// Autoplay policies gate audio.play() behind a user gesture having reached
// the page. The table is otherwise tap-free (see drawGesture.ts) but does
// receive ordinary pointerdown events for the reach gesture — good enough to
// unlock on, once, well before the first networked place/draw cue needs to
// make a sound.
// ============================================================

import cardPlaceUrl from '../assets/sounds/card-place.mp3';
import cardDrawUrl from '../assets/sounds/card-draw.mp3';

const SOUNDS = { place: cardPlaceUrl, draw: cardDrawUrl } as const;

type SoundName = keyof typeof SOUNDS;

const elements = new Map<SoundName, HTMLAudioElement>();

/** One element per clip, reused: placements and draws are turn-serialized,
 *  so a clip never needs to overlap with itself. */
function elementFor(name: SoundName): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null; // jsdom / no-DOM guard
  let el = elements.get(name);
  if (!el) {
    el = new Audio(SOUNDS[name]);
    el.preload = 'auto';
    elements.set(name, el);
  }
  return el;
}

/** Real browsers return a rejectable Promise (autoplay refusal); jsdom
 *  returns undefined outright. Swallow either. */
function safePlay(el: HTMLAudioElement): void {
  const result = el.play();
  if (result && typeof result.catch === 'function') result.catch(() => {});
}

function play(name: SoundName): void {
  const el = elementFor(name);
  if (!el) return;
  el.currentTime = 0;
  safePlay(el);
}

/** A card has come to rest — placed to an expedition or a discard pile. */
export function playCardPlaced(): void {
  play('place');
}

/** A card has been picked up — from the deck or a discard pile. */
export function playCardDrawn(): void {
  play('draw');
}

let unlocked = false;

/**
 * Play-then-immediately-pause on both clips: the standard unlock trick. Call
 * from the table's own pointerdown handler, so a real user gesture has
 * happened before the first networked event needs to make a sound.
 */
export function unlockSounds(): void {
  if (unlocked) return;
  unlocked = true;
  for (const name of Object.keys(SOUNDS) as SoundName[]) {
    const el = elementFor(name);
    if (!el) continue;
    const result = el.play();
    if (result && typeof result.then === 'function') {
      result.then(
        () => {
          el.pause();
          el.currentTime = 0;
        },
        () => {},
      );
    }
  }
}

/** Test seam — unlocked is module state and would otherwise leak between
 *  cases. Not called by the app. */
export function resetSoundUnlock(): void {
  unlocked = false;
}

/** Test seam — the cached elements are module state too, and a stubbed
 *  Audio constructor in one test must not leak into the next. Not called by
 *  the app. */
export function resetSoundElements(): void {
  elements.clear();
}
