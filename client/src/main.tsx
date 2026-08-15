// ============================================================
// Client composition root and role router.
//
//   /       role picker
//   /table  the shared tablet display
//   /play   a phone controller
//
// This is the only place the socket, the persistence store and the session
// store are constructed. Everything below consumes them through hooks.
// ============================================================

import { StrictMode, Suspense, lazy, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { demoHash, parseDemoHash } from './demo/route';
import { createLocalStorageRejoinStore } from './session/rejoinStore';
import { createSessionStore } from './session/session';
import { createSocketClient } from './session/socket';
import { SessionProvider } from './session/useSession';
import { Invite, joinUrl, parseInvite } from './shared/invite';
import { Table } from './table/Table';
import { Phone } from './phone/Phone';
import './styles/tokens.css';
import './styles/app.css';

/**
 * Everything under demo/ arrives in its own chunk, including the server it
 * runs in the browser. The LAN build never ships it and never fetches it.
 */
const DemoApp = lazy(() => import('./demo/DemoApp'));

const rejoin = createLocalStorageRejoinStore();

/**
 * Built on demand rather than at module scope.
 *
 * createSocketClient() opens a WebSocket the moment it is called and retries
 * for as long as the page is open. On a static host there is nothing to
 * reach, so a demo route must never construct one — it would spend the whole
 * session failing to connect to a server that does not exist.
 */
let live: ReturnType<typeof createSessionStore> | null = null;
function liveSession() {
  if (!live) live = createSessionStore(createSocketClient(), rejoin);
  return live;
}

/**
 * The table generates and owns its room code: the wire views carry no code
 * field, so a server-invented code could never reach the tablet to be shown.
 * Reusing the stored one means a refresh re-claims the same room.
 */
function tableCode(): string {
  const stored = rejoin.load();
  if (stored?.role === 'table' && /^[1-9][0-9]{2}$/.test(stored.code)) return stored.code;
  return String(100 + Math.floor(Math.random() * 900));
}

/** The two links a lobby QR encodes, one per seat, built from this room's code. */
function invitesFor(code: string): { seat: 0 | 1; url: string }[] {
  return [0, 1].map((seat) => ({
    seat: seat as 0 | 1,
    url: joinUrl(window.location, { code, seat: seat as 0 | 1 }),
  }));
}

/** This device's name from a previous game, offered as a join-screen default. */
function lastName(): string {
  const stored = rejoin.load();
  return stored?.role === 'player' ? stored.name ?? '' : '';
}

function RolePicker() {
  return (
    <div className="screen screen--picker">
      <h1 className="screen__title">Lost Cities</h1>
      <div className="picker__choices">
        <a className="action action--play" href="/table">
          This is the table
        </a>
        <a className="action" href="/play">
          I&rsquo;m a player
        </a>
        {/* Also the only working entry point on a static host, where /table
            and /play have no server to fall back to. */}
        <a className="action" href={demoHash({ view: 'index' })}>
          Demo &mdash; no server needed
        </a>
      </div>
      <p className="label screen__footnote">
        One tablet on the table, one phone each.
      </p>
    </div>
  );
}

function App() {
  // The code is fixed for the life of the page so a re-render cannot mint a
  // new room out from under the phones. The invite is read once for the
  // same reason — it describes how this page was opened, not its current
  // location, which a router-free app never changes without a reload anyway.
  const [code] = useState(tableCode);
  const [invite] = useState<Invite | null>(() => parseInvite(window.location.search));
  const path = window.location.pathname;

  if (path.startsWith('/table')) return <Table code={code} invites={invitesFor(code)} />;
  if (path.startsWith('/play')) return <Phone invite={invite} lastName={lastName()} />;
  return <RolePicker />;
}

// The demo owns its own session stores, one per interface, so it mounts
// outside the live provider entirely.
const demo = parseDemoHash(window.location.hash);

// The route is read once, at module scope, so crossing between the live app
// and the demo — or using the back button to do it — has to reload. Both
// sides construct their sockets on the way in, and neither is built to be
// torn down and swapped for the other while the page stays up.
window.addEventListener('hashchange', () => window.location.reload());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {demo ? (
      <Suspense fallback={<div className="screen" />}>
        <DemoApp params={demo} />
      </Suspense>
    ) : (
      <SessionProvider store={liveSession()}>
        <App />
      </SessionProvider>
    )}
  </StrictMode>,
);
