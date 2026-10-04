import type { ClientMessage, ProjectInfo, ServerMessage } from '@mapedit/protocol';

/** `connecting` is the first attempt; `reconnecting` follows a lost connection. */
export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'incompatible';

/** The subset of the browser WebSocket used here, so tests can supply their own. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type RequestMessage = Extract<
  ClientMessage,
  { type: 'previewEdit' | 'applyEdit' | 'undo' | 'redo' }
>;
type WithoutId<T> = T extends unknown ? Omit<T, 'requestId'> : never;
export type Request = WithoutId<RequestMessage>;

export interface ConnectionOptions {
  url: string;
  client: 'editor' | 'render';
  createSocket?: (url: string) => SocketLike;
  /** Wait before each reconnect attempt, in milliseconds; the last value repeats. */
  retryDelays?: readonly number[];
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface Events {
  status: ConnectionStatus;
  welcome: ProjectInfo;
  message: ServerMessage;
}
type Listener<K extends keyof Events> = (value: Events[K]) => void;

const OPEN = 1;
/** The close code the server uses for a message it cannot accept (protocol section 4, flow 8). */
const POLICY_VIOLATION = 1008;
const browserSocket = (url: string): SocketLike => new WebSocket(url) as unknown as SocketLike;
const serverTypes = new Set([
  'welcome',
  'scene',
  'previewResult',
  'editResult',
  'history',
  'notice',
]);

/**
 * One editor or render page connection: hello → welcome → openMap, with
 * automatic reconnection that reopens the current map.
 */
export class Connection {
  status: ConnectionStatus = 'connecting';
  project?: ProjectInfo;
  private mapId?: string;
  private socket?: SocketLike;
  private welcomed = false;
  /** The map last opened on the current socket. */
  private openedMap?: string;
  /** Maps opened on the current socket and not answered yet, oldest first. */
  private opening: string[] = [];
  /** The map whose scene the current socket last received: the one the server has open. */
  private shownMap?: string;
  private failures = 0;
  private nextRequestId = 1;
  private timer?: unknown;
  private stopped = false;
  private readonly listeners: { [K in keyof Events]: Set<Listener<K>> } = {
    status: new Set(),
    welcome: new Set(),
    message: new Set(),
  };

  constructor(private readonly options: ConnectionOptions) {}

  on<K extends keyof Events>(event: K, listener: Listener<K>): () => void {
    this.listeners[event].add(listener);
    return () => this.listeners[event].delete(listener);
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) (this.options.clearTimer ?? clearTimeout)(this.timer as never);
    this.timer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close(1000, 'Closed by the page.');
  }

  /** The map to show; it is reopened automatically after every reconnect. */
  openMap(mapId: string): void {
    this.mapId = mapId;
    if (this.welcomed) this.sendOpenMap();
  }

  /** Each connection opens a map once: the server answers every openMap with a full snapshot. */
  private sendOpenMap(): void {
    if (this.mapId === undefined || this.mapId === this.openedMap) return;
    if (!this.send({ type: 'openMap', mapId: this.mapId })) return;
    this.openedMap = this.mapId;
    this.opening.push(this.mapId);
  }

  private mapShown(mapId: string): void {
    if (this.opening[0] === mapId) this.opening.shift();
    this.shownMap = mapId;
  }

  /**
   * The server answers each openMap in order, and refuses a map that is not in
   * the project by keeping the one it had open. When the refused map is still
   * the one wanted, go back to the open map and ask for a fresh snapshot of it.
   */
  private mapRefused(): void {
    const refused = this.opening.shift();
    if (refused === undefined || refused !== this.mapId || this.opening.length) return;
    this.mapId = this.shownMap;
    this.openedMap = undefined;
    this.sendOpenMap();
  }

  get currentMap(): string | undefined {
    return this.mapId;
  }

  /** Sends a request with a fresh id, or returns undefined while offline. */
  request(message: Request): number | undefined {
    if (!this.welcomed || this.mapId === undefined) return undefined;
    const requestId = this.nextRequestId++;
    return this.send({ ...message, requestId } as RequestMessage) ? requestId : undefined;
  }

  private send(message: ClientMessage): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  private emit<K extends keyof Events>(event: K, value: Events[K]): void {
    // One failing listener must not keep the message from the others.
    for (const listener of [...this.listeners[event]])
      try {
        listener(value);
      } catch (error) {
        console.error(`mapedit: a ${event} listener failed`, error);
      }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }

  private connect(): void {
    this.timer = undefined;
    if (this.stopped) return;
    let socket: SocketLike;
    try {
      socket = (this.options.createSocket ?? browserSocket)(this.options.url);
    } catch {
      this.retry();
      return;
    }
    this.socket = socket;
    this.welcomed = false;
    this.openedMap = undefined;
    this.opening = [];
    this.shownMap = undefined;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.send({ type: 'hello', protocolVersion: 1, client: this.options.client });
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      const message = parseServerMessage(event.data);
      if (message) this.receive(message);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      // Before welcome the only message sent is hello: a server that cannot accept it
      // speaks another protocol version, and asking again would not change that.
      if (!this.welcomed && event.code === POLICY_VIOLATION) return this.incompatible();
      this.welcomed = false;
      this.retry();
    };
    socket.onerror = () => {};
  }

  private receive(message: ServerMessage): void {
    if (message.type === 'welcome') {
      if (message.protocolVersion !== 1) {
        this.incompatible();
        this.socket?.close(1000, 'Unsupported protocol version.');
        return;
      }
      this.welcomed = true;
      this.failures = 0;
      this.project = message.project;
      this.setStatus('open');
      // Reopen the current map before listeners run, so one choosing the same map adds nothing.
      this.sendOpenMap();
      this.emit('welcome', message.project);
    } else if (message.type === 'scene') this.mapShown(message.scene.map.id);
    else if (message.type === 'notice' && message.code === 'unknown_map') this.mapRefused();
    this.emit('message', message);
  }

  /** Stop for good: only a page and server of the same protocol version can talk. */
  private incompatible(): void {
    this.stopped = true;
    this.setStatus('incompatible');
  }

  private retry(): void {
    if (this.stopped) return;
    this.setStatus(this.status === 'connecting' ? 'connecting' : 'reconnecting');
    const delays = this.options.retryDelays ?? [250, 500, 1000, 2000, 4000];
    const delay = delays[Math.min(this.failures, delays.length - 1)] ?? 1000;
    this.failures++;
    this.timer = (this.options.setTimer ?? setTimeout)(() => this.connect(), delay);
  }
}

/** Ignore anything that is not a JSON object with a known server message type. */
export function parseServerMessage(data: unknown): ServerMessage | undefined {
  if (typeof data !== 'string') return undefined;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && serverTypes.has(type) ? (value as ServerMessage) : undefined;
}

export function socketUrl(location: { protocol: string; host: string }): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
}
