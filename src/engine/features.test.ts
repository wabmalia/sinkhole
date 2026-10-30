import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { courseOf } from '../sets';
import { settle, step, type Ball, type Course } from './physics';

// The hole elements on an open 360 × 900 floor, one at a time.
const open = courseOf('full-course/0');
const withOnly = (extra: Partial<Course>): Course => ({ ...open, cup: { x: -100, y: -100 }, ...extra });
const ball = (x: number, y: number, vx = 0, vy = 0, id = 0): Ball => ({
  id, pos: { x, y }, vel: { x: vx, y: vy }, sunk: false, from: { x, y },
});
const square = (x: number, y: number, w: number, h: number) => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

describe('ramps', () => {
  const ramp = (strength: number) => withOnly({ ramps: [{ area: square(0, 300, 360, 300), angle: 90, strength }] });

  // Balls only move during a shot, so each starts with a nudge.
  it('roll a slow ball downhill when steep enough', () => {
    const b = ball(180, 400, 1, 0);
    settle(ramp(400), [b]);
    expect(b.pos.y).toBeGreaterThan(600);
  });

  it('leave it be when gentler than rolling resistance', () => {
    const b = ball(180, 400);
    step(ramp(CONFIG.physics.rolling), [b]);
    expect(b.vel).toEqual({ x: 0, y: 0 });
  });

  it('slow a ball rolling uphill', () => {
    const flat = ball(180, 590, 0, -400);
    const up = ball(180, 590, 0, -400);
    settle(open, [flat]);
    settle(ramp(400), [up]);
    expect(up.pos.y).toBeGreaterThan(flat.pos.y);
  });

  it('at full steepness, turn back a full-power shot within 120 units', () => {
    const b = ball(180, 700, 0, -CONFIG.physics.maxSpeed);
    const wall = withOnly({ ramps: [{ area: square(0, 480, 360, 120), angle: 90, strength: 12000 }] });
    settle(wall, [b]);
    expect(b.pos.y).toBeGreaterThan(480);
  });

  it('let a ball pressed into a wall come to rest', () => {
    const b = ball(180, 885);
    const pressing = withOnly({ ramps: [{ area: square(0, 600, 360, 300), angle: 90, strength: 600 }] });
    settle(pressing, [b], 5);
    expect(b.vel).toEqual({ x: 0, y: 0 });
  });
});

describe('rivers', () => {
  const river = (width: number) => withOnly({ rivers: [square(0, 500, 360, width)] });
  const full = CONFIG.physics.maxSpeed;

  it('send a ball that stops in one back to where the shot started', () => {
    const b = ball(180, 700, 0, -500);
    const events = settle(river(40), [b]);
    expect(b.pos).toEqual({ x: 180, y: 700 });
    expect(b.vel).toEqual({ x: 0, y: 0 });
    expect(events.filter(e => e.type === 'reset')).toHaveLength(1);
  });

  it('let a hard shot across a narrow one', () => {
    // Only up to the far bank: on this open floor it later bounces back.
    const b = ball(180, 700, 0, -full);
    const events: ReturnType<typeof step> = [];
    for (let i = 0; i < 2400 && b.pos.y > 480; i++) events.push(...step(river(40), [b]));
    expect(events.some(e => e.type === 'reset')).toBe(false);
    expect(b.pos.y).toBeLessThan(480);
  });

  it('stop even a full-power shot in a wide one', () => {
    const b = ball(180, 700, 0, -full);
    const events = settle(river(200), [b]);
    expect(events.some(e => e.type === 'reset')).toBe(true);
  });
});

describe('wells', () => {
  it('a black hole bends a passing ball towards it', () => {
    const b = ball(100, 800, 0, -700);
    settle(withOnly({ wells: [{ kind: 'black', at: { x: 220, y: 450 }, radius: 150, strength: 400 }] }), [b]);
    expect(b.pos.x).toBeGreaterThan(100);
  });

  it('a black hole swallows a ball that reaches its core', () => {
    const b = ball(180, 700, 0, -300);
    const events = settle(withOnly({ wells: [{ kind: 'black', at: { x: 180, y: 500 }, radius: 200, strength: 800 }] }), [b]);
    expect(events.some(e => e.type === 'reset' && e.cause === 'blackHole')).toBe(true);
    expect(b.pos).toEqual({ x: 180, y: 700 });
  });

  it('a white hole pushes a ball out', () => {
    const b = ball(200, 450, 1, 0);
    settle(withOnly({ wells: [{ kind: 'white', at: { x: 180, y: 450 }, radius: 120, strength: 800 }] }), [b]);
    expect(b.pos.x).toBeGreaterThan(180 + 60);
  });
});

describe('portals', () => {
  const portals = withOnly({ portals: [{ color: 'pink', a: { x: 180, y: 600 }, b: { x: 80, y: 200 } }] });

  it('carry the ball across at the same velocity', () => {
    const b = ball(180, 640, 0, -400);
    const events: ReturnType<typeof step> = [];
    for (let i = 0; i < 60 && !events.some(e => e.type === 'portal'); i++) events.push(...step(portals, [b]));
    expect(events.find(e => e.type === 'portal')).toMatchObject({ color: 'pink', to: { x: 80, y: 200 } });
    expect(b.pos).toEqual({ x: 80, y: 200 });
    expect(b.vel.y).toBeLessThan(-300);
  });

  it("don't send it straight back", () => {
    const b = ball(180, 640, 0, -400);
    const events = settle(portals, [b]);
    expect(events.filter(e => e.type === 'portal')).toHaveLength(1);
  });
});
