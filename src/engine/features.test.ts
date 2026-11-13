import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { courseOf, holeOf } from '../sets';
import { courseFrom } from '../holes/types';
import { atRest, playOut, settle, step, TIMEOUT_STEPS, type Ball, type Course } from './physics';

// The hole elements on an open 360 × 900 floor, one at a time.
const open = courseOf('full-course/0');
const withOnly = (extra: Partial<Course>): Course => ({ ...open, cup: { x: -100, y: -100 }, ...extra });
const ball = (x: number, y: number, vx = 0, vy = 0, id = 0): Ball => ({
  id, pos: { x, y }, vel: { x: vx, y: vy }, sunk: false, from: { x, y },
});
// Seconds until every ball stops, up to settle's 30 s limit.
const restTime = (course: Course, balls: Ball[]) => {
  let t = 0;
  for (; t < 30 && !atRest(balls); t += CONFIG.physics.step) step(course, balls);
  return t;
};
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

  it('roll a ball back down once it stops climbing', () => {
    // It used to stop for good at the top of its roll, halfway up the slope.
    const b = ball(180, 850, 0, -300);
    settle(withOnly({ ramps: [{ area: square(0, 300, 360, 600), angle: 90, strength: 600 }] }), [b]);
    expect(b.pos.y).toBeGreaterThan(890);
  });

  it('let a ball pressed sideways along a wall come to rest', () => {
    // Steep and almost straight into the wall: barely any push along it.
    const b = ball(7, 500, 0, 40);
    const steep = withOnly({ ramps: [{ area: square(0, 0, 360, 900), angle: 179, strength: 12000 }] });
    expect(restTime(steep, [b])).toBeLessThan(3);
  });

  it('slide a ball pressed into a wall at an angle into the corner', () => {
    const b = ball(180, 885, 1, 0);
    const slope = withOnly({ ramps: [{ area: square(0, 600, 360, 300), angle: 45, strength: 6000 }] });
    expect(restTime(slope, [b])).toBeLessThan(3);
    expect(b.pos.x).toBeGreaterThan(350);
  });

  it('let a ball on a slope barely steeper than rolling resistance stop', () => {
    const b = ball(180, 400, 1, 0);
    const gentle = withOnly({ ramps: [{ area: square(0, 0, 360, 900), angle: 90, strength: CONFIG.physics.rolling + 1 }] });
    expect(restTime(gentle, [b])).toBeLessThan(1);
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

describe('mud', () => {
  const mud = (width: number) => withOnly({ mud: [square(0, 500, 360, width)] });

  it('stops a ball that runs out of pace in it, and leaves it there', () => {
    const b = ball(180, 700, 0, -500);
    const events = settle(mud(200), [b]);
    expect(events.some(e => e.type === 'reset')).toBe(false);
    expect(b.pos.y).toBeLessThan(700);
    expect(b.pos.y).toBeGreaterThan(500);
  });

  it('drags a ball almost as hard as a river', () => {
    const dry = ball(180, 700, 0, -900);
    const wet = ball(180, 700, 0, -900);
    settle(open, [dry]);
    settle(mud(200), [wet]);
    expect(wet.pos.y).toBeGreaterThan(dry.pos.y + 100);
  });

  it('holds a ball against a gentle ramp', () => {
    const b = ball(180, 600, 1, 0);
    const course = withOnly({ mud: [square(0, 500, 360, 200)], ramps: [{ area: square(0, 500, 360, 200), angle: 90, strength: 600 }] });
    settle(course, [b], 5);
    expect(b.pos.y).toBeLessThan(605);
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

  // A pull or push this strong bounced a ball off the wall and back into
  // it for ever, and the shot never ended.
  it('a black hole holds a ball against a wall between it and the core', () => {
    const b = ball(180, 120, 30, -200);
    const beyond = withOnly({ wells: [{ kind: 'black', at: { x: 180, y: -20 }, radius: 220, strength: 12000 }] });
    expect(restTime(beyond, [b])).toBeLessThan(3);
    expect(b.pos.y).toBeCloseTo(CONFIG.ball.radius, 1);
  });

  it('a white hole holds a ball against a wall', () => {
    const b = ball(60, 450, -100, 0);
    const near = withOnly({ wells: [{ kind: 'white', at: { x: 80, y: 450 }, radius: 150, strength: 6000 }] });
    expect(restTime(near, [b])).toBeLessThan(3);
    expect(b.pos.x).toBeCloseTo(CONFIG.ball.radius, 1);
  });

  it('balls piled against a wall by a black hole come to rest', () => {
    const balls = [0, 1, 2].map(i => ball(160 + i * 16, 120, 50 * (i - 1), -200, i));
    const beyond = withOnly({ wells: [{ kind: 'black', at: { x: 180, y: -20 }, radius: 220, strength: 12000 }] });
    expect(restTime(beyond, balls)).toBeLessThan(3);
    for (const b of balls) expect(b.pos.y).toBeGreaterThan(CONFIG.ball.radius - 0.01);
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

describe('round blocks', () => {
  it('bounce a ball off to the side it hit', () => {
    const course = courseFrom({ ...holeOf('full-course/0'), blocks: [{ at: { x: 180, y: 450 }, radius: 20 }] });
    const b = ball(185, 700, 0, -900);
    const events = settle({ ...course, cup: { x: -100, y: -100 } }, [b], 0.5);
    expect(events.some(e => e.type === 'wall')).toBe(true);
    expect(b.pos.x).toBeGreaterThan(185);
  });
});

describe('a shot running long', () => {
  it('is called off at the time limit: moving balls go back to where it started', () => {
    const moving = ball(180, 800, 0, -1500);
    const still = ball(60, 400, 0, 0, 1);
    const events = playOut(open, [moving, still], 10);
    expect(events).toContainEqual(expect.objectContaining({ type: 'reset', ball: 0, cause: 'timeout' }));
    expect(events.some(e => e.type === 'reset' && e.ball === 1)).toBe(false);
    expect(moving.pos).toEqual({ x: 180, y: 800 });
    expect(moving.vel).toEqual({ x: 0, y: 0 });
    expect(still.pos).toEqual({ x: 60, y: 400 });
  });

  it('is left alone when it settles in time', () => {
    const b = ball(180, 800, 0, -600);
    const events = playOut(open, [b]);
    expect(events.some(e => e.type === 'reset')).toBe(false);
    expect(b.pos.y).toBeLessThan(800);
  });

  it('times out after 15 seconds', () => {
    expect(TIMEOUT_STEPS * CONFIG.physics.step).toBe(CONFIG.rules.shotTimeout);
  });
});
