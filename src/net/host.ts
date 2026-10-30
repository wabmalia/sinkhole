import { current, EngineError, forfeit, MAX_PLAYERS, play, type Game, type Member } from '../engine/game';
import { createMatch, lastHole, nextHole, recordHole, type Match } from '../engine/match';
import type { Shot } from '../engine/shot';
import type { Vec } from '../engine/vec';
import { DEFAULT_SET, hasSet, setOf } from '../sets';
import { cleanName, validAim, validAt, validShot, type Aim, type RoomView, type ToClient, type ToHost } from './protocol';

/** One connection to a remote browser. */
export interface Link {
  send(msg: ToClient): void;
  close(): void;
}

export interface HostSnapshot {
  code: string;
  hostId: string;
  members: Member[];
  setId?: string;
  match?: Match | null;
  game: Game | null;
}

export interface HostEvents {
  /** The room changed; the host's own screen should update. */
  change(room: RoomView): void;
  /** A shot was played; animate it before taking the next room update. */
  shot(by: string, shot: Shot, at?: Vec): void;
  aim(by: string, aim: Aim): void;
  /** Save this so a refreshed host tab can resume the room. */
  persist(snap: HostSnapshot): void;
}

/** How long a disconnected player's turn waits before they pick up. */
export const AWAY_MS = 30_000;

/**
 * The authoritative room, running in the host's browser. Owns the members and
 * the game; remote players only send their aim and their shots.
 */
export class HostRoom {
  readonly code: string;
  readonly hostId: string;
  private members: Member[];
  private setId: string;
  private match: Match | null;
  private game: Game | null;
  private links = new Map<string, Link>();
  private spectators = new Set<Link>();
  private away: ReturnType<typeof setTimeout> | undefined;

  constructor(
    snap: HostSnapshot,
    private events: HostEvents,
    private awayMs = AWAY_MS,
  ) {
    this.code = snap.code;
    this.hostId = snap.hostId;
    this.members = snap.members;
    this.setId = hasSet(snap.setId) ? snap.setId : DEFAULT_SET;
    this.match = snap.match ?? null;
    // A game saved before sets existed has no match: back to the lobby.
    this.game = this.match ? snap.game : null;
    this.scheduleAway();
  }

  /** Wire up a freshly opened connection. */
  attach(link: Link) {
    let id: string | null = null;
    return {
      message: (raw: unknown) => {
        const msg = raw as ToHost;
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'hello') {
          id = this.hello(link, msg);
          return;
        }
        if (!id) return;
        if (msg.t === 'aim') this.aim(id, msg.aim);
        else if (msg.t === 'shot') this.shot(id, msg.shot, msg.at, link);
      },
      closed: () => {
        this.spectators.delete(link);
        if (id && this.links.get(id) === link) {
          this.links.delete(id);
          this.changed();
        }
      },
    };
  }

  // Host-side controls ------------------------------------------------------

  /** Pick the set to play, in the lobby. */
  chooseSet(id: string) {
    if (this.game || !hasSet(id)) return;
    this.setId = id;
    this.changed();
  }

  /** Play the chosen set from the first hole: from the lobby, or again once it's over. */
  start() {
    if (this.game && !(this.game.phase === 'over' && this.match && lastHole(this.match))) return;
    ({ match: this.match, game: this.game } = createMatch(this.setId, setOf(this.setId).holes, this.members, this.absent()));
    this.changed();
  }

  /** On to the next hole once this one is over. */
  nextHole() {
    const { match, game } = this;
    if (!match || !game || game.phase !== 'over' || lastHole(match)) return;
    ({ match: this.match, game: this.game } = nextHole(match, game, this.members, this.absent()));
    this.changed();
  }

  backToLobby() {
    this.match = null;
    this.game = null;
    this.changed();
  }

  kick(id: string) {
    if (this.game || id === this.hostId) return;
    this.members = this.members.filter(m => m.id !== id);
    const link = this.links.get(id);
    link?.send({ t: 'rejected', reason: 'Removed by the host' });
    link?.close();
    this.links.delete(id);
    this.changed();
  }

  hostAim(aim: Aim) {
    this.aim(this.hostId, aim);
  }

  hostShot(shot: Shot, at?: Vec): string | null {
    return this.shot(this.hostId, shot, at, null);
  }

  view(): RoomView {
    return {
      code: this.code,
      hostId: this.hostId,
      members: this.members.map(m => ({
        id: m.id,
        name: m.name,
        connected: m.id === this.hostId || this.links.has(m.id),
      })),
      setId: this.setId,
      match: this.match,
      game: this.game,
    };
  }

  snapshot(): HostSnapshot {
    return { code: this.code, hostId: this.hostId, members: this.members, setId: this.setId, match: this.match, game: this.game };
  }

  dispose() {
    clearTimeout(this.away);
    for (const l of [...this.links.values(), ...this.spectators]) l.close();
  }

  // Internals ---------------------------------------------------------------

  private hello(link: Link, msg: Extract<ToHost, { t: 'hello' }>): string | null {
    const id = String(msg.id ?? '').slice(0, 64);
    if (!id || id === this.hostId) {
      link.send({ t: 'rejected', reason: 'Invalid player id' });
      return null;
    }
    const existing = this.members.find(m => m.id === id);
    if (existing) {
      // Reconnect: take over the seat, drop any stale connection.
      const old = this.links.get(id);
      if (old && old !== link) old.close();
    } else if (this.game) {
      // Hole in progress: watch only.
      this.spectators.add(link);
      link.send({ t: 'room', room: this.view() });
      return null;
    } else if (this.members.length >= MAX_PLAYERS) {
      link.send({ t: 'rejected', reason: 'Room is full' });
      return null;
    } else {
      this.members.push({ id, name: this.uniqueName(cleanName(msg.name)) });
    }
    this.links.set(id, link);
    this.changed();
    return id;
  }

  private aim(id: string, aim: unknown) {
    const g = this.game;
    if (!g || g.phase !== 'aim' || current(g).id !== id || !validAim(aim)) return;
    const msg: ToClient = { t: 'aim', by: id, aim };
    for (const [who, l] of this.links) if (who !== id) l.send(msg);
    for (const l of this.spectators) l.send(msg);
    if (id !== this.hostId) this.events.aim(id, aim);
  }

  private shot(id: string, shot: unknown, at: unknown, link: Link | null): string | null {
    if (!this.game) return 'The hole has not started';
    if (!validShot(shot) || !validAt(at)) return 'Bad shot';
    let next: Game;
    try {
      next = play(this.game, id, shot, at).game;
    } catch (e) {
      const msg = e instanceof EngineError ? e.message : 'Invalid shot';
      link?.send({ t: 'error', msg });
      return msg;
    }
    this.broadcast({ t: 'shot', by: id, shot, at });
    this.events.shot(id, shot, at);
    this.setGame(next);
    this.changed();
    return null;
  }

  // The hole moves on; once it's over, it goes on the cards.
  private setGame(next: Game) {
    this.game = next;
    if (this.match) this.match = recordHole(this.match, next);
  }

  // Players with no connection right now: they start the next hole picked up.
  private absent(): Set<string> {
    return new Set(this.members.filter(m => m.id !== this.hostId && !this.links.has(m.id)).map(m => m.id));
  }

  private uniqueName(name: string): string {
    const taken = new Set(this.members.map(m => m.name));
    if (!taken.has(name)) return name;
    for (let i = 2; ; i++) {
      const candidate = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  private changed() {
    const room = this.view();
    this.broadcast({ t: 'room', room });
    this.events.change(room);
    this.events.persist(this.snapshot());
    this.scheduleAway();
  }

  private broadcast(msg: ToClient) {
    for (const l of this.links.values()) l.send(msg);
    for (const l of this.spectators) l.send(msg);
  }

  /** If it's a disconnected player's turn, they pick up after a while. */
  private scheduleAway() {
    clearTimeout(this.away);
    const g = this.game;
    if (!g || g.phase !== 'aim') return;
    const who = current(g).id;
    if (who === this.hostId || this.links.has(who)) return;
    this.away = setTimeout(() => {
      if (this.game !== g) return;
      this.setGame(forfeit(g));
      this.changed();
    }, this.awayMs);
  }
}
