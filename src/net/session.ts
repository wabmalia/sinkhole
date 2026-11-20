import { host, join, store, tabId, type Guest, type Host } from '@wabmalia/courier';
import type { Shot } from '../engine/shot';
import type { Vec } from '../engine/vec';
import { HostRoom, type HostSnapshot } from './host';
import { iceServers } from './relay';
import { clearSharedSet, DEFAULT_SET, hasSet, useSharedSet } from '../sets';
import { onBrowserSets } from '../sets/browser';
import { cleanName, newRoomCode, PEER_PREFIX, type Aim, type RoomView, type ToClient, type ToHost } from './protocol';

// The connection side. Courier (@wabmalia/courier) does the connecting: the
// room code, heartbeats, reconnects and the relay. This keeps what's
// Sinkhole's: the host room, saving it across refreshes, solo play (the same
// host room with no connection at all) and the shots and aims screens animate.
// Screens listen for changes.

export type Status = 'home' | 'connecting' | 'room' | 'error';

export interface SessionListener {
  change?(): void;
  shot?(by: string, shot: Shot, at?: Vec): void;
  aim?(by: string, aim: Aim): void;
  toast?(text: string): void;
}

const ID_KEY = 'sinkhole.id';
const snapKey = (code: string) => `sinkhole.host.${code}`;
// A solo game is saved like a hosted room, under this code.
const SOLO = 'SOLO';

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
  /** Playing alone: a host room with no connection. */
  solo = false;
  code = '';
  me = tabId(ID_KEY);
  room: RoomView | null = null;
  /** False while a client is reconnecting to the host. */
  linked = true;
  /** Each guest's round trip to the host, in ms, by id. */
  pings: Record<string, number> = {};
  name = store.get(localStorage, 'sinkhole.name') ?? '';

  private listeners = new Set<SessionListener>();
  private host: HostRoom | null = null;
  private hosting: Host | null = null;
  private guest: Guest<ToHost> | null = null;

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
    const saved = this.openRoom(resumeCode ?? null, newRoomCode(), 'Host');
    this.set({ status: 'connecting', message: saved ? 'Reopening your room…' : 'Creating room…', room: this.host!.view() });
    const room = this.host!;
    const code = this.code;
    this.hosting = host<ToClient>({
      prefix: PEER_PREFIX,
      code,
      fresh: !saved,
      iceServers: () => iceServers(),
      attach: link => room.attach(link),
      open: () => {
        this.set({ status: 'room' });
        location.hash = `#/host/${code}`;
      },
      // Code collision on a brand new room: just pick another.
      codeTaken: () => this.hostRoom(),
      notice: text => {
        if (this.status === 'room') this.emit('toast', text);
        else this.set({ message: text });
      },
      fail: message => this.fail(message),
      pings: pings => (this.pings = pings),
    });
  }

  /** Play alone, straight to picking a set; or carry on after a refresh. */
  playSolo(resume = false) {
    this.openRoom(resume ? SOLO : null, SOLO, 'Player');
    this.solo = true;
    this.set({ status: 'room', room: this.host!.view() });
    location.hash = '#/solo';
  }

  // The host room itself, new or from its saved snapshot. True if resumed.
  private openRoom(resumeCode: string | null, newCode: string, fallbackName: string): boolean {
    this.teardown();
    const saved = resumeCode ? savedHost(resumeCode) : null;
    const code = saved?.code ?? newCode;
    const snap: HostSnapshot = saved ?? {
      code,
      hostId: this.me,
      members: [{ id: this.me, name: this.name || fallbackName }],
      setId: DEFAULT_SET,
      match: null,
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
    return !!saved;
  }

  chooseSet(id: string) {
    this.host?.chooseSet(id);
  }
  start() {
    this.host?.start();
  }
  nextHole() {
    this.host?.nextHole();
  }
  backToLobby() {
    this.host?.backToLobby();
  }
  kick(id: string) {
    this.host?.kick(id);
  }
  setsChanged() {
    this.host?.setsChanged();
  }

  // Joining ---------------------------------------------------------------

  joinRoom(code: string) {
    this.teardown();
    this.role = 'client';
    this.code = code;
    this.set({ status: 'connecting', message: `Looking for room ${code}…` });
    store.set(sessionStorage, 'sinkhole.joined', code);
    const me = this.me;
    this.guest = join<ToClient, ToHost>({
      prefix: PEER_PREFIX,
      code,
      id: me,
      hello: () => ({ t: 'hello', id: me, name: this.name || 'Player' }),
      message: msg => this.receive(msg),
      status: s => this.set({ linked: s === 'linked' }),
      fail: message => this.fail(message),
      pings: pings => (this.pings = pings),
      iceServers: () => iceServers(),
    });
  }

  private receive(msg: ToClient) {
    switch (msg.t) {
      case 'room':
        this.set({ room: msg.room, status: 'room' });
        location.hash = `#/join/${this.code}`;
        break;
      case 'set':
        if (!useSharedSet(String(msg.id), msg.set)) this.fail(`Couldn't load the host's set.`);
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

  // Shared ----------------------------------------------------------------

  shoot(shot: Shot, at?: Vec) {
    if (this.host) {
      const err = this.host.hostShot(shot, at);
      if (err) this.emit('toast', err);
    } else {
      this.guest?.send({ t: 'shot', shot, at });
    }
  }

  aim(aim: Aim) {
    if (this.host) this.host.hostAim(aim);
    else this.guest?.send({ t: 'aim', aim });
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
    this.hosting?.close();
    this.hosting = null;
    this.guest?.close();
    this.guest = null;
    this.host?.dispose();
    this.host = null;
    this.room = null;
    this.role = null;
    this.solo = false;
    this.linked = true;
    this.pings = {};
    this.me = tabId(ID_KEY);
    clearSharedSet();
  }

  private fail(message: string) {
    this.teardown();
    this.set({ status: 'error', message });
  }

  /** Called once on page load: resume hosting or rejoin after a refresh. */
  restore() {
    // Dev shortcut: ?solo=<set> goes straight into a solo game of that set.
    const quick = import.meta.env.DEV ? new URLSearchParams(location.search).get('solo') : null;
    if (quick !== null) {
      history.replaceState(null, '', location.pathname);
      this.playSolo();
      if (hasSet(quick)) this.chooseSet(quick);
      this.start();
      return;
    }
    const [, kind, raw] = location.hash.split('/');
    const code = (raw ?? '').toUpperCase();
    if (kind === 'solo' && savedHost(SOLO)) this.playSolo(true);
    else if (kind === 'host' && code && savedHost(code)) this.hostRoom(code);
    else if (kind === 'join' && code && store.get(sessionStorage, 'sinkhole.joined') === code) this.joinRoom(code);
  }
}

export const session = new Session();

// The editor, open in another tab, saved or deleted a set: the room may be
// playing it.
onBrowserSets(() => session.setsChanged());
