import { Peer, type DataConnection } from 'peerjs';
import type { Shot } from '../engine/shot';
import type { Vec } from '../engine/vec';
import { HostRoom, type HostSnapshot } from './host';
import { cleanName, newRoomCode, PEER_PREFIX, type Aim, type RoomView, type ToClient, type ToHost } from './protocol';

// The connection side, the same shape as turn7's: one browser hosts the room
// over PeerJS, the others join by code. Screens listen for changes.

export type Status = 'home' | 'connecting' | 'room' | 'error';

export interface SessionListener {
  change?(): void;
  shot?(by: string, shot: Shot, at?: Vec): void;
  aim?(by: string, aim: Aim): void;
  toast?(text: string): void;
}

// Storage can throw (private mode, blocked site data); none of it is essential.
const store = {
  get(area: Storage, key: string): string | null {
    try {
      return area.getItem(key);
    } catch {
      return null;
    }
  },
  set(area: Storage, key: string, value: string | null) {
    try {
      if (value === null) area.removeItem(key);
      else area.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
};

/** Per-tab identity, so a refresh reclaims the same seat but two tabs are two players. */
function tabId(): string {
  let id = store.get(sessionStorage, 'sinkhole.id');
  if (!id) {
    id = crypto.randomUUID();
    store.set(sessionStorage, 'sinkhole.id', id);
  }
  return id;
}

/** How long a guest waits for the direct connection before giving up. */
const JOIN_TIMEOUT_MS = 15_000;

const snapKey =(code: string) => `sinkhole.host.${code}`;

function savedHost(code: string): HostSnapshot | null {
  const raw = store.get(localStorage, snapKey(code));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HostSnapshot;
  } catch {
    return null;
  }
}

class Session {
  status: Status = 'home';
  message = '';
  role: 'host' | 'client' | null = null;
  code = '';
  me = tabId();
  room: RoomView | null = null;
  /** False while a client is reconnecting to the host. */
  linked = true;
  name = store.get(localStorage, 'sinkhole.name') ?? '';

  private listeners = new Set<SessionListener>();
  private peer: Peer | null = null;
  private host: HostRoom | null = null;
  private conn: DataConnection | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;

  listen(l: SessionListener) {
    this.listeners.add(l);
  }

  private emit<K extends keyof SessionListener>(kind: K, ...args: Parameters<NonNullable<SessionListener[K]>>) {
    for (const l of this.listeners) (l[kind] as ((...a: unknown[]) => void) | undefined)?.(...args);
  }

  private set(patch: Partial<Pick<Session, 'status' | 'message' | 'room' | 'linked'>>) {
    Object.assign(this, patch);
    this.emit('change');
  }

  setName(name: string) {
    this.name = cleanName(name);
    store.set(localStorage, 'sinkhole.name', this.name);
  }

  get isHost() {
    return this.role === 'host';
  }

  // Hosting ---------------------------------------------------------------

  /** Create a room, or resume one this browser was hosting (after a refresh). */
  hostRoom(resumeCode?: string) {
    this.teardown();
    const saved = resumeCode ? savedHost(resumeCode) : null;
    const code = saved?.code ?? newRoomCode();
    const snap: HostSnapshot = saved ?? {
      code,
      hostId: this.me,
      members: [{ id: this.me, name: this.name || 'Host' }],
      game: null,
    };
    this.me = snap.hostId;
    this.role = 'host';
    this.code = code;
    this.host = new HostRoom(snap, {
      change: room => this.set({ room }),
      shot: (by, shot, at) => this.emit('shot', by, shot, at),
      aim: (by, aim) => this.emit('aim', by, aim),
      persist: s => store.set(localStorage, snapKey(s.code), JSON.stringify(s)),
    });
    this.set({ status: 'connecting', message: saved ? 'Reopening your room…' : 'Creating room…', room: this.host.view() });
    this.openHostPeer(code, !saved, 0);
  }

  private openHostPeer(code: string, fresh: boolean, attempt: number) {
    const peer = new Peer(PEER_PREFIX + code);
    this.peer = peer;
    peer.on('open', () => {
      this.set({ status: 'room' });
      location.hash = `#/host/${code}`;
    });
    peer.on('connection', conn => {
      conn.on('open', () => {
        const h = this.host!.attach({
          send: m => conn.open && conn.send(m),
          close: () => conn.close(),
        });
        conn.on('data', h.message);
        conn.on('close', h.closed);
        conn.on('error', h.closed);
      });
    });
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
    peer.on('error', err => {
      if (this.peer !== peer) return;
      if (err.type === 'unavailable-id') {
        peer.destroy();
        // Code collision on a brand new room: just pick another.
        if (fresh) return this.hostRoom();
        // The broker still remembers our old connection; it frees up shortly.
        if (attempt < 20) {
          this.set({ message: 'Reclaiming your room code…' });
          this.retry = setTimeout(() => this.openHostPeer(code, false, attempt + 1), 3000);
          return;
        }
      }
      if (this.status === 'room' && (err.type === 'network' || err.type === 'server-error')) {
        this.emit('toast', 'Lost the matchmaking server, retrying…');
        return;
      }
      if (this.status !== 'room') this.fail(`Could not open the room (${err.type}).`);
    });
  }

  start() {
    this.host?.start();
  }
  backToLobby() {
    this.host?.backToLobby();
  }
  kick(id: string) {
    this.host?.kick(id);
  }

  // Joining ---------------------------------------------------------------

  joinRoom(code: string) {
    this.teardown();
    this.role = 'client';
    this.code = code;
    this.set({ status: 'connecting', message: `Looking for room ${code}…` });
    store.set(sessionStorage, 'sinkhole.joined', code);
    const peer = new Peer();
    this.peer = peer;
    peer.on('open', () => this.connectToHost());
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
    peer.on('error', err => {
      if (this.peer !== peer) return;
      if (err.type === 'peer-unavailable') {
        if (this.room) return this.scheduleReconnect();
        return this.fail(`Couldn't find room ${code}. Check the code, and that the host still has the page open.`);
      }
      if (this.room) return this.scheduleReconnect();
      this.fail(`Connection failed (${err.type}).`);
    });
  }

  private connectToHost() {
    if (!this.peer || this.peer.destroyed) return;
    const conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true, serialization: 'json' });
    this.conn = conn;
    // The room was found but the browsers can't reach each other directly.
    const stuck = () => {
      if (this.conn !== conn || conn.open || this.room) return;
      this.fail(
        `Found room ${this.code} but couldn't connect to it. A browser privacy setting may be blocking WebRTC ` +
          `(Brave Shields, or WebRTC options in Firefox-based browsers). Try another browser or turn those off for this site.`,
      );
    };
    const timer = setTimeout(stuck, JOIN_TIMEOUT_MS);
    conn.peerConnection?.addEventListener('iceconnectionstatechange', () => {
      const state = conn.peerConnection?.iceConnectionState;
      console.info('[sinkhole] connection', state);
      if (state === 'failed') stuck();
    });
    conn.on('open', () => {
      clearTimeout(timer);
      this.set({ linked: true });
      this.send({ t: 'hello', id: this.me, name: this.name || 'Player' });
    });
    conn.on('data', d => this.receive(d as ToClient));
    conn.on('close', () => {
      if (this.conn !== conn) return;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    this.set({ linked: false });
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.connectToHost(), 2500);
  }

  private receive(msg: ToClient) {
    switch (msg.t) {
      case 'room':
        this.set({ room: msg.room, status: 'room' });
        location.hash = `#/join/${this.code}`;
        break;
      case 'shot':
        this.emit('shot', msg.by, msg.shot, msg.at);
        break;
      case 'aim':
        this.emit('aim', msg.by, msg.aim);
        break;
      case 'error':
        this.emit('toast', msg.msg);
        break;
      case 'rejected':
        this.fail(msg.reason);
        store.set(sessionStorage, 'sinkhole.joined', null);
        break;
    }
  }

  private send(msg: ToHost) {
    if (this.conn?.open) this.conn.send(msg);
  }

  // Shared ----------------------------------------------------------------

  shoot(shot: Shot, at?: Vec) {
    if (this.host) {
      const err = this.host.hostShot(shot, at);
      if (err) this.emit('toast', err);
    } else {
      this.send({ t: 'shot', shot, at });
    }
  }

  aim(aim: Aim) {
    if (this.host) this.host.hostAim(aim);
    else this.send({ t: 'aim', aim });
  }

  /** Leave the room. A host leaving closes it for everyone. */
  leave() {
    if (this.host) store.set(localStorage, snapKey(this.code), null);
    store.set(sessionStorage, 'sinkhole.joined', null);
    this.teardown();
    this.set({ status: 'home' });
    location.hash = '#/';
  }

  private teardown() {
    clearTimeout(this.retry);
    this.host?.dispose();
    this.host = null;
    this.conn = null;
    this.peer?.destroy();
    this.peer = null;
    this.room = null;
    this.role = null;
    this.linked = true;
    this.me = tabId();
  }

  private fail(message: string) {
    this.teardown();
    this.set({ status: 'error', message });
  }

  /** Called once on page load: resume hosting or rejoin after a refresh. */
  restore() {
    const [, kind, raw] = location.hash.split('/');
    const code = (raw ?? '').toUpperCase();
    if (kind === 'host' && code && savedHost(code)) this.hostRoom(code);
    else if (kind === 'join' && code && store.get(sessionStorage, 'sinkhole.joined') === code) this.joinRoom(code);
  }
}

export const session = new Session();
