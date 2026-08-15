// The link that gets a phone into a game without typing an address.
//
// Pure — no DOM beyond the URL constructor, no fetch. The tablet writes one
// of these per open seat; a phone reads one out of its own location. Both
// directions live here so they cannot drift apart: a change to the query
// shape can only be made once, in a function whose inverse is right below
// it and exercised in the same test.

import { Seat } from '@shared/types';

export interface Invite {
  code: string;
  seat: Seat;
}

/**
 * The URL a QR on the tablet encodes for one seat.
 *
 * `location` is deliberately the structural slice of `window.location` this
 * needs, not the whole thing, so a test can hand it a plain object. The path
 * is derived by swapping the tablet's own last segment rather than hardcoded
 * to `/play`, so an install served under a subpath (a PR preview, a reverse
 * proxy) keeps producing a working link with no configuration of its own.
 */
export function joinUrl(location: { origin: string; pathname: string }, invite: Invite): string {
  const path = location.pathname.replace(/\/table\/?$/, '/play');
  const url = new URL(path, location.origin);
  url.searchParams.set('code', invite.code);
  url.searchParams.set('seat', String(invite.seat));
  return url.toString();
}

/**
 * The inverse: what a phone's own `location.search` says about the seat it
 * was pointed at, or `null` when there is nothing there or it does not
 * parse. The code is checked against the exact pattern the join screen and
 * `main.tsx`'s room-code generator already use, so a malformed or truncated
 * link is refused rather than handed to the server as a half-valid guess.
 */
export function parseInvite(search: string): Invite | null {
  const params = new URLSearchParams(search);
  const code = params.get('code') ?? '';
  if (!/^[1-9][0-9]{2}$/.test(code)) return null;

  const seat = params.get('seat');
  if (seat !== '0' && seat !== '1') return null;

  return { code, seat: seat === '1' ? 1 : 0 };
}

/**
 * What a phone should treat as the invite in play: the scanned link itself
 * when it points somewhere this device is not already sitting, or `null`
 * when there is nothing to override.
 *
 * A device holding a stale membership would otherwise ignore a scanned link
 * and sit at "Joining…" against a room that no longer wants it — so a
 * different room wins. The same room is deliberately a no-op rather than a
 * forced reroute: re-scanning mid-game should just resume, not interrupt.
 */
export function resolveInvite(invite: Invite | null, storedCode: string | null): Invite | null {
  return invite && invite.code !== storedCode ? invite : null;
}
