import { describe, expect, it } from 'vitest';
import { ServerMessage } from '@shared/types';
import type { Connection } from '../../../server/transport';
import { MessagePort, createBridgeSocket, hostBridge } from './bridge';
import { createHub, DEMO_CODE } from './hub';

/** Drains the microtask queue, where the pane's ready announcement lands. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A stand-in for a Window. jsdom can host real iframes, but wiring two of
 * them says more about jsdom than about this module — what matters is that
 * frames posted at one end arrive at the other.
 */
class FakeWindow implements MessagePort {
  private handlers = new Set<(event: MessageEvent) => void>();
  readonly origins: string[] = [];

  /**
   * Delivers to *this* window's listeners, matching the DOM: you post to
   * the window you want to reach, and the event fires there. The bridge
   * depends on that direction — the pane posts to window.parent, the host
   * posts to iframe.contentWindow.
   */
  postMessage(data: unknown, targetOrigin: string): void {
    this.origins.push(targetOrigin);
    queueMicrotask(() => {
      for (const handler of [...this.handlers]) handler({ data } as MessageEvent);
    });
  }

  addEventListener(_type: 'message', handler: (event: MessageEvent) => void): void {
    this.handlers.add(handler);
  }

  removeEventListener(_type: 'message', handler: (event: MessageEvent) => void): void {
    this.handlers.delete(handler);
  }

  get listenerCount(): number {
    return this.handlers.size;
  }
}

/** Parent and pane, bridged, with the hub behind the parent. */
function bridged(seed = 1) {
  const parent = new FakeWindow();
  const pane = new FakeWindow();

  const hub = createHub(seed);
  const adopted: Connection[] = [];
  const host = hostBridge(
    parent,
    () => pane,
    (connection) => {
      adopted.push(connection);
      hub.adopt(connection);
    },
    'https://example.test',
  );

  const socket = createBridgeSocket(pane, parent, 'seat0', 'https://example.test');
  const received: ServerMessage[] = [];
  socket.onMessage((message) => received.push(message));

  return { parent, pane, hub, host, socket, received, adopted };
}

describe('the postMessage bridge', () => {
  it('carries a join to the server and a view back', async () => {
    const { socket, received } = bridged();
    await flush();

    socket.send({ t: 'joinPlayer', code: DEMO_CODE, seat: 0, name: 'Ada' });
    await flush();

    const state = received.find((message) => message.t === 'state');
    expect(state).toBeDefined();
    expect(state?.t === 'state' && state.view.viewer).toBe('player');
  });

  it('pins every post to the origin it was given', async () => {
    const { parent, pane, socket } = bridged();
    await flush();
    socket.send({ t: 'startRound' });
    await flush();

    const posts = [...parent.origins, ...pane.origins];
    expect(posts.length).toBeGreaterThan(0);
    expect(new Set(posts)).toEqual(new Set(['https://example.test']));
  });

  it('ignores postMessage traffic that is not ours', async () => {
    const { pane, received } = bridged();
    await flush();

    // Anything on the same channel from an unrelated sender must not be
    // parsed as a protocol frame. Posted at the pane, which is the side
    // that would otherwise try to read it as a server frame.
    pane.postMessage({ hello: 'world' }, 'https://example.test');
    pane.postMessage('a bare string', 'https://example.test');
    await flush();

    expect(received).toEqual([]);
  });

  it('ignores frames addressed to a different pane', async () => {
    const { pane, received } = bridged();
    await flush();

    pane.postMessage(
      { tag: 'lost-cities-demo', kind: 'down', id: 'seat1', raw: '{"t":"error"}' },
      'https://example.test',
    );
    await flush();

    expect(received).toEqual([]);
  });

  it('treats a pane announcing itself again as a reconnect', async () => {
    const { pane, parent, hub, adopted } = bridged();
    await flush();
    expect(adopted).toHaveLength(1);

    let closed = false;
    adopted[0].onClose(() => {
      closed = true;
    });

    // What a reloaded iframe does.
    createBridgeSocket(pane, parent, 'seat0', 'https://example.test');
    await flush();

    expect(closed).toBe(true);
    expect(adopted).toHaveLength(2);
    expect(hub).toBeDefined();
  });

  it('tells the pane when the server goes away, so the bar can show', async () => {
    const { socket, adopted } = bridged();
    await flush();

    const statuses: string[] = [];
    socket.onStatusChange((status) => statuses.push(status));

    adopted[0].close();
    await flush();

    // 'reconnecting', not 'closed': from the pane's side a server that has
    // stopped answering is indistinguishable from one that will come back.
    expect(statuses).toEqual(['reconnecting']);
  });

  it('stops listening once each side is done', async () => {
    const { pane, parent, socket, host, adopted } = bridged();
    await flush();

    const paneBefore = pane.listenerCount;
    socket.close();
    expect(pane.listenerCount).toBe(paneBefore - 1);

    const parentBefore = parent.listenerCount;
    adopted[0].close();
    host.stop();
    expect(parent.listenerCount).toBe(parentBefore - 2);
  });
});
