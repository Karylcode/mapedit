import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type MapeditServer } from '@mapedit/server';
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
  drop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: '' });
  }
}

const project = { name: 'Demo', maps: [{ id: 'village', name: 'Village' }] };

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

describe('Connection against the mock server', () => {
  let server: MapeditServer | undefined;
  let connection: Connection | undefined;
  afterEach(async () => {
    connection?.stop();
    await server?.close();
    server = connection = undefined;
  });

  it('receives the project, scene and history, then survives a server restart', async () => {
    server = await createServer({ mock: true, port: 0 });
    const port = server.port;
    connection = new Connection({
      url: `ws://127.0.0.1:${port}/ws`,
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
    server = await createServer({ mock: true, port });
    received.length = 0;
    await waitFor(() => received.some((m) => m.type === 'scene'));
    expect(connection.status).toBe('open');
  });
});
