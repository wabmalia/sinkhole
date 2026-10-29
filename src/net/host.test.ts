import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_PLAYERS } from '../engine/game';
import { resolveShot } from '../engine/shot';
import { HostRoom, type Link } from './host';
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

function room(awayMs = 1000) {
  const shots: string[] = [];
  const r = new HostRoom(
    { code: 'ABCDE', hostId: 'host', members: [{ id: 'host', name: 'Hosty' }], game: null },
    { change: () => {}, shot: by => shots.push(by), aim: () => {}, persist: () => {} },
    awayMs,
  );
  return { r, shots };
}

const UP = -Math.PI / 2;
const shot = resolveShot(UP, 0.3, 0.3);

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
    expect(r.hostShot({ angle: NaN, power: 1, grade: 'perfect', miss: 0 })).toBe('Bad shot');
    expect(r.view().game!.shots).toBe(0);
  });

  it('relays the aim of whoever is up to the others', () => {
    const { r } = room();
    const a = fakeLink();
    r.attach(a).message({ t: 'hello', id: 'p1', name: 'Ana' });
    r.start();
    const aim = { angle: 1, power: 0.5, at: { x: 1, y: 2 }, meter: false };
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
});
