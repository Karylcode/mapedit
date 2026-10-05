import { afterEach, describe, expect, it } from 'vitest';
import { createServer as createHttpServer, type IncomingMessage } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { createServer, mockScene, type MapeditServer } from '@mapedit/server';
import type { ClientMessage, ServerMessage } from '@mapedit/protocol';
import {
  Connection,
  parseServerMessage,
  socketUrl,
  type SocketLike,
} from '../src/net/connection.js';

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: ClientMessage[] = [];
  onopen: SocketLike['onopen'] = null;
  onclose: SocketLike['onclose'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onerror: SocketLike['onerror'] = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(message: ServerMessage | string): void {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
  }
  drop(code = 1006, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

const project = { name: 'Demo', maps: [{ id: 'village', name: 'Village' }] };
const sceneOf = (id: string): ServerMessage => {
  const scene = mockScene();
  return { type: 'scene', scene: { ...scene, map: { ...scene.map, id } } };
};

function fakeConnection() {
  FakeSocket.all = [];
  const timers: (() => void)[] = [];
  const connection = new Connection({
    url: 'ws://test/ws',
    client: 'editor',
    createSocket: (url) => new FakeSocket(url),
    setTimer: (callback) => timers.push(callback),
    clearTimer: () => {},
  });
  const statuses: string[] = [];
  const messages: ServerMessage[] = [];
  connection.on('status', (status) => statuses.push(status));
  connection.on('message', (message) => messages.push(message));
  return { connection, timers, statuses, messages };
}

describe('Connection', () => {
  it('says hello, then opens the requested map after welcome', () => {
    const { connection, statuses } = fakeConnection();
    connection.openMap('village');
    connection.start();
    const socket = FakeSocket.all[0]!;
    socket.open();
    expect(socket.sent).toEqual([{ type: 'hello', protocolVersion: 1, client: 'editor' }]);
    socket.receive({ type: 'welcome', protocolVersion: 1, project });
    expect(socket.sent.at(-1)).toEqual({ type: 'openMap', mapId: 'village' });
    expect(connection.project).toEqual(project);
    expect(statuses).toEqual(['open']);
  });

  it('reconnects after losing the socket and reopens the current map', () => {
    const { connection, timers, statuses } = fakeConnection();
    connection.start();
    FakeSocket.all[0]!.open();
    FakeSocket.all[0]!.receive({ type: 'welcome', protocolVersion: 1, project });
    connection.openMap('village');
    FakeSocket.all[0]!.drop();
    expect(statuses.at(-1)).toBe('reconnecting');
    expect(connection.request({ type: 'undo' })).toBeUndefined();
    timers.shift()!();
    const second = FakeSocket.all[1]!;
    second.open();
    second.receive({ type: 'welcome', protocolVersion: 1, project });
    expect(second.sent).toEqual([
      { type: 'hello', protocolVersion: 1, client: 'editor' },
      { type: 'openMap', mapId: 'village' },
    ]);
    expect(statuses.at(-1)).toBe('open');
  });

  it('opens the map exactly once per connection when the page opens it on welcome (FE10)', () => {
    const { connection, timers } = fakeConnection();
    // Like the editor: choose and open a map whenever the server says welcome.
    connection.on('welcome', () => connection.openMap('village'));
    const openMaps = (socket: FakeSocket) => socket.sent.filter((m) => m.type === 'openMap');
    connection.start();
    FakeSocket.all[0]!.open();
    FakeSocket.all[0]!.receive({ type: 'welcome', protocolVersion: 1, project });
    expect(openMaps(FakeSocket.all[0]!)).toHaveLength(1);
    FakeSocket.all[0]!.drop();
    timers.shift()!();
    FakeSocket.all[1]!.open();
    FakeSocket.all[1]!.receive({ type: 'welcome', protocolVersion: 1, project });
    expect(openMaps(FakeSocket.all[1]!)).toHaveLength(1);
    // Switching maps still sends each new choice.
    connection.openMap('second');
    connection.openMap('village');
    expect(openMaps(FakeSocket.all[1]!).map((m) => m.mapId)).toEqual([
      'village',
      'second',
      'village',
    ]);
  });

  it('goes back to the open map when the server refuses the one wanted (FE13)', () => {
    const { connection } = fakeConnection();
    const refusal: ServerMessage = {
      type: 'notice',
      level: 'error',
      code: 'unknown_map',
      message: 'Map "gone" does not exist.',
    };
    const openMaps = () => socket.sent.filter((m) => m.type === 'openMap').map((m) => m.mapId);
    connection.openMap('village');
    connection.start();
    const socket = FakeSocket.all[0]!;
    socket.open();
    socket.receive({ type: 'welcome', protocolVersion: 1, project });
    socket.receive(sceneOf('village'));

    // A deleted map, then another one before the first answer: the refusal is for the first.
    connection.openMap('gone');
    connection.openMap('second');
    socket.receive(refusal);
    expect(connection.currentMap).toBe('second');
    socket.receive(sceneOf('second'));

    // Refused while still wanted: back to the map the server kept, with a fresh snapshot.
    connection.openMap('gone');
    socket.receive(refusal);
    expect(connection.currentMap).toBe('second');
    expect(openMaps()).toEqual(['village', 'gone', 'second', 'gone', 'second']);

    // A refusal that answers no openMap changes nothing.
    socket.receive(sceneOf('second'));
    socket.receive(refusal);
    expect(connection.currentMap).toBe('second');
    expect(openMaps()).toHaveLength(5);
  });

  it('keeps retrying while the server is down, backing off', () => {
    const { connection, timers, statuses } = fakeConnection();
    connection.start();
    FakeSocket.all[0]!.drop();
    timers.shift()!();
    FakeSocket.all[1]!.drop();
    expect(FakeSocket.all).toHaveLength(2);
    expect(timers).toHaveLength(1);
    expect(statuses).toEqual([]);
    expect(connection.status).toBe('connecting');
  });

  it('numbers requests and refuses them before a map is open', () => {
    const { connection } = fakeConnection();
    connection.start();
    const socket = FakeSocket.all[0]!;
    socket.open();
    socket.receive({ type: 'welcome', protocolVersion: 1, project });
    expect(connection.request({ type: 'undo' })).toBeUndefined();
    connection.openMap('village');
    const first = connection.request({ type: 'undo' });
    const second = connection.request({
      type: 'previewEdit',
      edit: { kind: 'delete', ref: 'structure:house' },
    });
    expect(second).toBe(first! + 1);
    expect(socket.sent.slice(-2)).toEqual([
      { type: 'undo', requestId: first },
      { type: 'previewEdit', requestId: second, edit: { kind: 'delete', ref: 'structure:house' } },
    ]);
  });

  it('ignores malformed server messages', () => {
    const { connection, messages } = fakeConnection();
    connection.start();
    const socket = FakeSocket.all[0]!;
    socket.open();
    socket.receive('not json');
    socket.receive('{"type":"surprise"}');
    socket.receive('[1,2]');
    expect(messages).toEqual([]);
  });

  it('stops on an incompatible protocol version', () => {
    const { connection, timers, statuses } = fakeConnection();
    connection.start();
    const socket = FakeSocket.all[0]!;
    socket.open();
    socket.receive({ type: 'welcome', protocolVersion: 2, project } as unknown as ServerMessage);
    expect(statuses).toEqual(['incompatible']);
    socket.drop();
    expect(timers).toHaveLength(0);
  });

  it('lets go of the open map when the Agent deletes it (F40)', () => {
    const { connection } = fakeConnection();
    connection.openMap('village');
    connection.start();
    const socket = FakeSocket.all[0]!;
    socket.open();
    socket.receive({ type: 'welcome', protocolVersion: 1, project });
    socket.receive(sceneOf('village'));
    const openMaps = () => socket.sent.filter((m) => m.type === 'openMap').map((m) => m.mapId);
    // Another map's deletion is no news for this connection.
    socket.receive({
      type: 'notice',
      level: 'error',
      code: 'unknown_map',
      message: 'Map "elsewhere" does not exist.',
      mapId: 'elsewhere',
    });
    expect(connection.currentMap).toBe('village');
    // Its own map: nothing is open on the server any more, and nothing is asked again.
    socket.receive({
      type: 'notice',
      level: 'error',
      code: 'unknown_map',
      message: 'Map "village" does not exist.',
      mapId: 'village',
    });
    expect(connection.currentMap).toBeUndefined();
    expect(connection.request({ type: 'undo' })).toBeUndefined();
    expect(openMaps()).toEqual(['village']);
    // Choosing another map opens it as usual.
    connection.openMap('second');
    expect(openMaps()).toEqual(['village', 'second']);
  });

  it('stops when the server refuses hello with 1008 (FE15)', () => {
    const { connection, timers, statuses } = fakeConnection();
    connection.start();
    const socket = FakeSocket.all[0]!;
    socket.open();
    expect(socket.sent).toEqual([{ type: 'hello', protocolVersion: 1, client: 'editor' }]);
    socket.drop(1008, 'Invalid protocol message.');
    expect(statuses).toEqual(['incompatible']);
    expect(connection.status).toBe('incompatible');
    expect(timers).toHaveLength(0);
  });

  it('reconnects after a 1008 once welcomed: the version matched (FE15)', () => {
    const { connection, timers, statuses } = fakeConnection();
    connection.start();
    const socket = FakeSocket.all[0]!;
    socket.open();
    socket.receive({ type: 'welcome', protocolVersion: 1, project });
    socket.drop(1008, 'Open a map first.');
    expect(statuses).toEqual(['open', 'reconnecting']);
    expect(timers).toHaveLength(1);
  });
});

describe('parseServerMessage and socketUrl', () => {
  it('accepts only known message types', () => {
    expect(parseServerMessage('{"type":"history","entries":[],"cursor":0}')).toEqual({
      type: 'history',
      entries: [],
      cursor: 0,
    });
    expect(parseServerMessage(new ArrayBuffer(2))).toBeUndefined();
  });

  it('derives the WebSocket address from the page', () => {
    expect(socketUrl({ protocol: 'http:', host: '127.0.0.1:4790' })).toBe('ws://127.0.0.1:4790/ws');
    expect(socketUrl({ protocol: 'https:', host: 'localhost:5173' })).toBe(
      'wss://localhost:5173/ws',
    );
  });
});

/**
 * A fixed WebSocket address in front of a backend that restarts on a new port,
 * so no test reuses a port another worker may have taken meanwhile. The Host
 * header is rewritten to the backend's own, which the backend checks.
 */
async function stableAddress() {
  let target: number | undefined;
  const sockets = new Set<Socket>();
  const proxy = createHttpServer((_, response) => response.writeHead(502).end());
  proxy.on('upgrade', (request: IncomingMessage, client: Socket, head: Buffer) => {
    const port = target;
    if (port === undefined) return client.destroy();
    const upstream = connect(port, '127.0.0.1', () => {
      const lines = [`${request.method} ${request.url} HTTP/1.1`];
      for (let i = 0; i < request.rawHeaders.length; i += 2) {
        const name = request.rawHeaders[i]!;
        const value =
          name.toLowerCase() === 'host' ? `127.0.0.1:${port}` : request.rawHeaders[i + 1];
        lines.push(`${name}: ${value}`);
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => (client.destroy(), upstream.destroy()));
    }
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  return {
    port: (proxy.address() as AddressInfo).port,
    /** Forward new connections to this backend port. */
    forwardTo(port: number) {
      target = port;
    },
    close() {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => proxy.close(() => resolve()));
    },
  };
}

describe('Connection against the mock server', () => {
  let server: MapeditServer | undefined;
  let connection: Connection | undefined;
  let address: Awaited<ReturnType<typeof stableAddress>> | undefined;
  afterEach(async () => {
    connection?.stop();
    await server?.close();
    await address?.close();
    server = connection = address = undefined;
  });

  it('receives the project, scene and history, then survives a server restart', async () => {
    server = await createServer({ mock: true, port: 0 });
    address = await stableAddress();
    address.forwardTo(server.port);
    connection = new Connection({
      url: `ws://127.0.0.1:${address.port}/ws`,
      client: 'editor',
      retryDelays: [50],
    });
    const received: ServerMessage[] = [];
    connection.on('message', (message) => received.push(message));
    const waitFor = (predicate: () => boolean) =>
      expect.poll(predicate, { timeout: 5000, interval: 20 }).toBe(true);
    connection.openMap('village');
    connection.start();
    await waitFor(() => received.some((m) => m.type === 'history'));
    expect(received.map((m) => m.type)).toEqual(['welcome', 'scene', 'history']);
    expect(connection.project?.name).toBe('Mock project');

    await server.close();
    await waitFor(() => connection!.status === 'reconnecting');
    // The backend comes back on a port of its own; the page's address stays the same.
    server = await createServer({ mock: true, port: 0 });
    address.forwardTo(server.port);
    received.length = 0;
    await waitFor(() => received.some((m) => m.type === 'scene'));
    expect(connection.status).toBe('open');
  });
});
