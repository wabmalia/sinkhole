import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config';
import { MAX_PLAYERS } from '../engine/game';
import { DEFAULT_SET, holeKeys } from '../sets';
import { saveBrowserSet } from '../sets/browser';
import { parseSet } from '../sets/format';
import { HostRoom, type HostSnapshot, type Link } from './host';
import type { RoomView, ToClient } from './protocol';

function fakeLink() {
  const inbox: ToClient[] = [];
  const link: Link & { inbox: ToClient[]; closed: boolean } = {
    inbox,
    closed: false,
    send: m => inbox.push(m),
    close: () => {
      link.closed = true;
    },
  };
  return link;
}

const lastRoom = (link: { inbox: ToClient[] }): RoomView =>
  (link.inbox.filter(m => m.t === 'room').at(-1) as Extract<ToClient, { t: 'room' }>).room;

function room(awayMs = 1000, snap: Partial<HostSnapshot> = {}) {
  const shots: string[] = [];
  const r = new HostRoom(
    { code: 'ABCDE', hostId: 'host', members: [{ id: 'host', name: 'Hosty' }], setId: DEFAULT_SET, match: null, game: null, solo: false, ...snap },
    { change: () => {}, shot: by => shots.push(by), aim: () => {}, persist: () => {} },
    awayMs,
  );
  return { r, shots };
}

// The host alone: nudge the ball until they pick up, which ends the hole.
function pickUpHole(r: HostRoom) {
  for (let i = 0; i < CONFIG.rules.maxStrokes; i++) expect(r.hostShot({ angle: Math.PI / 2, power: 0.05 })).toBeNull();
  expect(r.view().game!.phase).toBe('over');
}

const UP = -Math.PI / 2;
const shot = { angle: UP, power: 0.3 };

afterEach(() => vi.useRealTimers());

describe('HostRoom', () => {
  it('adds players by nickname, deduped and trimmed', () => {
    const { r } = room();
    const l = fakeLink();
    r.attach(l).message({ t: 'hello', id: 'p1', name: '  Hosty\u0000 ' });
    r.attach(fakeLink()).message({ t: 'hello', id: 'p2', name: 'x'.repeat(40) });
    expect(lastRoom(l).members.map(m => m.name)).toEqual(['Hosty', 'Hosty 2', 'x'.repeat(16)]);
  });

  it(`caps the room at ${MAX_PLAYERS}`, () => {
    const { r } = room();
    for (let i = 1; i < MAX_PLAYERS; i++) r.attach(fakeLink()).message({ t: 'hello', id: `p${i}`, name: 'P' });
    const late = fakeLink();
    r.attach(late).message({ t: 'hello', id: 'extra', name: 'Extra' });
    expect(late.inbox).toContainEqual({ t: 'rejected', reason: 'Room is full' });
    expect(r.view().members).toHaveLength(MAX_PLAYERS);
  });

  it('newcomers after the start can only watch', () => {
    const { r } = room();
    r.start();
    const l = fakeLink();
    r.attach(l).message({ t: 'hello', id: 'late', name: 'Late' });
    expect(r.view().members).toHaveLength(1);
    expect(lastRoom(l).game).not.toBeNull();
  });

  it('plays a shot from the right player, sending the shot before the new state', () => {
    const { r, shots } = room();
    const l = fakeLink();
    const h = r.attach(l);
    h.message({ t: 'hello', id: 'p1', name: 'Ana' });
    r.start();
    h.message({ t: 'shot', shot });
    expect(l.inbox.at(-1)).toEqual({ t: 'error', msg: 'Not your turn' });
    expect(r.hostShot(shot)).toBeNull();
    expect(shots).toEqual(['host']);
    const kinds = l.inbox.slice(-2).map(m => m.t);
    expect(kinds).toEqual(['shot', 'room']);
    expect(lastRoom(l).game!.players[0]!.strokes).toBe(1);
    h.message({ t: 'shot', shot });
    expect(lastRoom(l).game!.players[1]!.strokes).toBe(1);
  });

  it('ignores malformed shots', () => {
    const { r } = room();
    r.start();
    expect(r.hostShot({ angle: NaN, power: 1 })).toBe('Bad shot');
    expect(r.view().game!.shots).toBe(0);
  });

  it('relays the aim of whoever is up to the others', () => {
    const { r } = room();
    const a = fakeLink();
    r.attach(a).message({ t: 'hello', id: 'p1', name: 'Ana' });
    r.start();
    const aim = { angle: 1, power: 0.5, at: { x: 1, y: 2 } };
    r.hostAim(aim);
    expect(a.inbox.at(-1)).toEqual({ t: 'aim', by: 'host', aim });
  });

  it('a disconnected player picks up when their turn times out', () => {
    vi.useFakeTimers();
    const { r } = room(1000);
    const h = r.attach(fakeLink());
    h.message({ t: 'hello', id: 'p1', name: 'Ana' });
    r.start();
    r.hostShot(shot);
    h.closed();
    vi.advanceTimersByTime(1000);
    const p1 = r.view().game!.players[1]!;
    expect(p1.pickedUp).toBe(true);
  });

  it('picks the set in the lobby only', () => {
    const { r } = room();
    expect(r.view().setId).toBe(DEFAULT_SET);
    r.chooseSet('nope');
    expect(r.view().setId).toBe(DEFAULT_SET);
    r.start();
    expect(r.view().game!.holeId).toBe(holeKeys(DEFAULT_SET)[0]);
    r.chooseSet('nope');
    expect(r.view().setId).toBe(DEFAULT_SET);
  });

  it('plays the set hole by hole, keeping the cards, then can play it again', () => {
    const { r } = room();
    const holes = holeKeys(DEFAULT_SET);
    r.start();
    r.nextHole(); // not before the hole is over
    expect(r.view().match!.index).toBe(0);
    for (let i = 0; i < holes.length; i++) {
      expect(r.view().game!.holeId).toBe(holes[i]);
      r.start(); // not mid-set
      expect(r.view().match!.index).toBe(i);
      pickUpHole(r);
      expect(r.view().match!.cards.host).toHaveLength(i + 1);
      r.nextHole();
    }
    const done = r.view();
    expect(done.match!.index).toBe(holes.length - 1);
    expect(done.match!.cards.host).toEqual(holes.map(() => CONFIG.rules.maxStrokes + 1));
    r.start();
    expect(r.view().match!.index).toBe(0);
    expect(r.view().match!.cards.host).toEqual([]);
    r.backToLobby();
    expect(r.view().match).toBeNull();
    expect(r.view().game).toBeNull();
  });

  it('starts a hole with anyone offline already picked up', () => {
    const { r } = room();
    const h = r.attach(fakeLink());
    h.message({ t: 'hello', id: 'p1', name: 'Ana' });
    h.closed();
    r.start();
    const p1 = r.view().game!.players.find(p => p.id === 'p1')!;
    expect(p1.pickedUp).toBe(true);
  });

  it('drops a match whose set has changed back to the lobby', () => {
    const { r } = room();
    r.start();
    const snap = r.snapshot();
    const old = { ...snap.match!, holes: snap.match!.holes.slice(1) };
    const { r: back } = room(1000, { setId: DEFAULT_SET, match: old, game: snap.game });
    expect(back.view().game).toBeNull();
    const { r: same } = room(1000, { setId: DEFAULT_SET, match: snap.match, game: snap.game });
    expect(same.view().game).not.toBeNull();
  });

  it('plays sets saved in the browser only when solo', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    const hole = { name: 'Only', par: 3, outline: [[0, 0], [360, 0], [360, 900], [0, 900]], blocks: [], tee: { x: 120, y: 790, w: 120, h: 70 }, cup: [180, 130] };
    saveBrowserSet('mine', parseSet({ name: 'Mine', holes: [hole] }).set!);
    vi.resetModules();
    const { HostRoom: Fresh } = await import('./host');
    const make = (solo: boolean) =>
      new Fresh({ code: 'SOLO', hostId: 'host', members: [{ id: 'host', name: 'Me' }], setId: DEFAULT_SET, match: null, game: null, solo }, { change() {}, shot() {}, aim() {}, persist() {} });
    const shared = make(false);
    shared.chooseSet('my:mine');
    expect(shared.view().setId).toBe(DEFAULT_SET);
    const solo = make(true);
    solo.chooseSet('my:mine');
    expect(solo.view().setId).toBe('my:mine');
    solo.start();
    expect(solo.view().game!.holeId).toBe('my:mine/0');
    expect(solo.snapshot().solo).toBe(true);
    vi.unstubAllGlobals();
  });
});
