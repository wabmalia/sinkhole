import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { courseOf, holeOf } from '../holes';
import { canPlace, createGame, current, EngineError, forfeit, play, teeSpot } from './game';
import { settle, shotVelocity, type Ball, type Course } from './physics';
import { swayAt, type Shot } from './shot';

const UP = -Math.PI / 2;
const straight = holeOf('straight');
const course: Course = courseOf('straight');
const ball = (x: number, y: number, vx = 0, vy = 0, id = 0): Ball => ({ id, pos: { x, y }, vel: { x: vx, y: vy }, sunk: false });

describe('physics', () => {
  it('a ball slows down and stops', () => {
    const b = ball(180, 700, 0, -600);
    settle(course, [b]);
    expect(b.vel).toEqual({ x: 0, y: 0 });
    expect(b.pos.y).toBeLessThan(700);
  });

  it('bounces off walls and stays on the course', () => {
    const b = ball(180, 450, 1500, 300);
    const events = settle(course, [b]);
    expect(events.some(e => e.type === 'wall')).toBe(true);
    expect(b.pos.x).toBeGreaterThanOrEqual(CONFIG.ball.radius - 0.01);
    expect(b.pos.x).toBeLessThanOrEqual(360 - CONFIG.ball.radius + 0.01);
  });

  it('a gentle putt drops in the cup', () => {
    const b = ball(180, 200);
    b.vel = shotVelocity(UP, 0.12);
    settle(course, [b]);
    expect(b.sunk).toBe(true);
  });

  it('a screamer lips out over the cup', () => {
    const b = ball(180, 200, 0, -1400);
    const events = settle(course, [b], 0.1);
    expect(events.some(e => e.type === 'sunk')).toBe(false);
  });

  it('a ball knocks another one along', () => {
    const a = ball(180, 600, 0, -800, 0);
    const b = ball(180, 500, 0, 0, 1);
    const events = settle(course, [a, b]);
    expect(events.some(e => e.type === 'ball')).toBe(true);
    expect(b.pos.y).toBeLessThan(500);
  });
});

describe('game', () => {
  const perfect = (power: number): Shot => ({ angle: UP, power });
  const members = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

  it('only lets the ball be placed on the tee before the first shot', () => {
    let g = createGame('straight', members(1));
    expect(canPlace(g)).toBe(true);
    const t = straight.tee;
    expect(teeSpot(g, { x: 0, y: 0 })).toEqual({ x: t.x + CONFIG.ball.radius, y: t.y + CONFIG.ball.radius });
    g = play(g, 'p0', perfect(0.05), { x: 0, y: 0 }).game;
    expect(canPlace(g)).toBe(false);
    expect(g.players[0]!.ball!.pos.x).toBeLessThan(t.x + CONFIG.ball.radius + 1);
  });

  it('takes turns and refuses shots out of turn', () => {
    let g = createGame('straight', members(3));
    expect(() => play(g, 'p1', perfect(0.1))).toThrow(EngineError);
    g = play(g, 'p0', perfect(0.1)).game;
    expect(current(g).id).toBe('p1');
    expect(g.players[0]!.strokes).toBe(1);
    g = forfeit(g);
    expect(current(g).id).toBe('p2');
    expect(g.players[1]!.pickedUp).toBe(true);
  });

  it('does not change the state it was given', () => {
    const g = createGame('straight', members(1));
    play(g, 'p0', perfect(0.5));
    expect(g.players[0]!.strokes).toBe(0);
    expect(g.shots).toBe(0);
  });

  it('a holed ball finishes that player', () => {
    let g = createGame('straight', members(1));
    g.players[0]!.ball!.pos = { x: 180, y: 200 };
    g = play(g, 'p0', perfect(0.12)).game;
    expect(g.players[0]!.holed).toBe(true);
    expect(g.phase).toBe('over');
  });

  it('picks the ball up after too many strokes and ends when nobody is left', () => {
    let g = createGame('straight', members(1));
    for (let i = 0; i < CONFIG.rules.maxStrokes; i++) g = play(g, 'p0', perfect(0)).game;
    expect(g.players[0]!.pickedUp).toBe(true);
    expect(g.players[0]!.strokes).toBe(CONFIG.rules.maxStrokes + 1);
    expect(g.phase).toBe('over');
  });
});

describe('sway', () => {
  const deg = (r: number) => (r * 180) / Math.PI;
  const samples = (power: number) => Array.from({ length: 400 }, (_, i) => swayAt(i / 100, power));

  it('swings no more than the set degrees either side', () => {
    for (const power of [0, 0.5, 1]) {
      const s = samples(power).map(deg);
      expect(Math.max(...s)).toBeLessThanOrEqual(CONFIG.sway.degrees + 1e-9);
      expect(Math.min(...s)).toBeGreaterThanOrEqual(-CONFIG.sway.degrees - 1e-9);
      expect(Math.max(...s)).toBeGreaterThan(CONFIG.sway.degrees * 0.95);
    }
  });

  it('swings faster on harder shots', () => {
    const crossings = (power: number) => samples(power).filter((v, i, a) => i > 0 && Math.sign(v) !== Math.sign(a[i - 1]!)).length;
    expect(crossings(1)).toBeGreaterThan(crossings(0));
  });
});
