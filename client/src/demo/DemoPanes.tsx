// ============================================================
// All three interfaces at once, sharing one match.
//
// Each pane is an iframe loading the same standalone route you would open
// on a real device, bridged to the hub this page owns. So a pane is not a
// second rendering path to keep in step — it is the same code, in a real
// viewport, with a different transport.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Connection } from '../../../server/transport';
import { DemoChrome } from './DemoChrome';
import { hostBridge } from './bridge';
import { useDemoGame } from './DemoRoute';
import { DemoParams, demoHash } from './route';

interface Pane {
  id: string;
  label: string;
  hash: string;
  width: number;
  height: number;
}

function panes(params: DemoParams): Pane[] {
  const table: Pane = {
    id: 'table',
    label: 'Table',
    hash: demoHash({ ...params, view: 'table' }),
    width: 1024,
    height: 768,
  };
  // Portrait, because that is the only way the phone is held. A landscape
  // pane shows the rotate gate and nothing else, which is correct behaviour
  // and a useless demo. The panes are real iframes precisely so that media
  // queries resolve against a real viewport, so the size here is the whole
  // of what decides it.
  const phone = (seat: 0 | 1): Pane => ({
    id: `seat${seat}`,
    label: `Seat ${seat}`,
    hash: demoHash({ ...params, view: 'play', seat }),
    width: 390,
    height: 844,
  });

  // With a bot on seat 1 there is no seat 1 pane: joining a seat replaces
  // whoever holds it, so the pane would silently unbind the bot and the
  // game would stop moving.
  return params.bot ? [table, phone(0)] : [table, phone(0), phone(1)];
}

export function DemoPanes({ params }: { params: DemoParams }) {
  const game = useDemoGame({ ...params, view: 'panes' });
  const layout = useMemo(() => panes(params), [params]);

  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const connections = useRef(new Map<string, Connection>());
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    const host = hostBridge(
      window,
      (id) => frames.current.get(id)?.contentWindow ?? null,
      (connection, id) => {
        // A pane that reloads announces again; its previous connection has
        // already closed itself, so this simply replaces the record.
        connections.current.set(id, connection);
        game.hub.adopt(connection);
      },
      window.location.origin,
    );
    return () => host.stop();
  }, [game]);

  return (
    <div className="demo-panes">
      <DemoChrome
        params={params}
        steps={game.steps}
        reached={game.reached}
        stopped={stopped}
        onDropSeat={() => {
          // A real reload of that frame: the pane announces itself again,
          // the old connection closes, and the router rebinds the seat.
          const frame = frames.current.get('seat0');
          if (frame) frame.src = frame.src;
        }}
        onStopServer={() => {
          for (const connection of connections.current.values()) connection.close();
          game.hub.closeAll();
          for (const bot of game.bots) bot.stop();
          setStopped(true);
        }}
      />

      <div className="demo-panes__stage">
        {layout.map((pane) => (
          <figure key={pane.id} className="demo-pane" style={{ width: pane.width }}>
            <figcaption className="demo-pane__label label">
              {pane.label}
              <span className="demo-pane__size">
                {pane.width}×{pane.height}
              </span>
            </figcaption>
            <div
              className="demo-pane__screen"
              style={{ width: pane.width, height: pane.height }}
            >
              <iframe
                title={pane.label}
                className="demo-pane__frame"
                width={pane.width}
                height={pane.height}
                src={`${window.location.pathname}${pane.hash}`}
                ref={(node) => {
                  if (node) frames.current.set(pane.id, node);
                  else frames.current.delete(pane.id);
                }}
              />
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}
