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

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createLocalStorageRejoinStore } from './session/rejoinStore';
import { createSessionStore } from './session/session';
import { createSocketClient } from './session/socket';
import { SessionProvider } from './session/useSession';
import { Table } from './table/Table';
import { Phone } from './phone/Phone';
import './styles/tokens.css';
import './styles/app.css';

const rejoin = createLocalStorageRejoinStore();
const socket = createSocketClient();
const session = createSessionStore(socket, rejoin);

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
      </div>
      <p className="label screen__footnote">
        One tablet on the table, one phone each.
      </p>
    </div>
  );
}

function App() {
  // The code is fixed for the life of the page so a re-render cannot mint a
  // new room out from under the phones.
  const [code] = useState(tableCode);
  const path = window.location.pathname;

  if (path.startsWith('/table')) return <Table code={code} />;
  if (path.startsWith('/play')) return <Phone />;
  return <RolePicker />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider store={session}>
      <App />
    </SessionProvider>
  </StrictMode>,
);
