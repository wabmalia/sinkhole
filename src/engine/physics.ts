import { CONFIG } from '../config';
import type { Segment } from '../holes/types';
import { closestOnSegment, dist, dot, fromAngle, len, lerp, scale, sub, type Vec } from './vec';

export interface Ball {
  id: number;
  pos: Vec;
  vel: Vec;
  sunk: boolean;
}

export interface Course {
  walls: Segment[];
  cup: Vec;
}

// What happened during a step, so the scene can flash and spark.
export type PhysicsEvent =
  | { type: 'wall'; ball: number; at: Vec; speed: number }
  | { type: 'ball'; a: number; b: number; at: Vec; speed: number }
  | { type: 'sunk'; ball: number };

const P = CONFIG.physics;
const R = CONFIG.ball.radius;

export function shotVelocity(angle: number, power: number): Vec {
  return fromAngle(angle, lerp(P.minSpeed, P.maxSpeed, power));
}

export function atRest(balls: Ball[]): boolean {
  return balls.every(b => b.sunk || (b.vel.x === 0 && b.vel.y === 0));
}

// Advance every ball by one fixed step. Mutates the balls.
export function step(course: Course, balls: Ball[], dt = P.step): PhysicsEvent[] {
  const events: PhysicsEvent[] = [];
  const live = balls.filter(b => !b.sunk);

  for (const b of live) {
    const speed = len(b.vel);
    if (speed === 0) continue;

    // Rolling resistance plus drag, never reversing the ball.
    const slow = (P.rolling + P.drag * speed) * dt;
    if (speed - slow <= P.stopSpeed) {
      b.vel = { x: 0, y: 0 };
    } else {
      b.vel = scale(b.vel, (speed - slow) / speed);
    }

    cupSlope(course.cup, b, dt);
    b.pos = { x: b.pos.x + b.vel.x * dt, y: b.pos.y + b.vel.y * dt };
  }

  for (const b of live) {
    for (const w of course.walls) {
      const hit = bounceOffWall(b, w);
      if (hit > 0) events.push({ type: 'wall', ball: b.id, at: { ...b.pos }, speed: hit });
    }
  }

  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const hit = collideBalls(live[i]!, live[j]!);
      if (hit > 0) {
        const at = scale({ x: live[i]!.pos.x + live[j]!.pos.x, y: live[i]!.pos.y + live[j]!.pos.y }, 0.5);
        events.push({ type: 'ball', a: live[i]!.id, b: live[j]!.id, at, speed: hit });
      }
    }
  }

  for (const b of live) {
    if (dist(b.pos, course.cup) < CONFIG.cup.radius && len(b.vel) <= CONFIG.cup.captureSpeed) {
      b.sunk = true;
      b.pos = { ...course.cup };
      b.vel = { x: 0, y: 0 };
      events.push({ type: 'sunk', ball: b.id });
    }
  }

  return events;
}

// The ground dips into the cup: once the ball overlaps it, it is pulled in.
// A slow ball curls in, a fast one lips out.
function cupSlope(cup: Vec, b: Ball, dt: number) {
  const d = sub(cup, b.pos);
  const l = len(d);
  if (l === 0 || l > CONFIG.cup.radius + R) return;
  const pull = CONFIG.cup.pull * dt;
  b.vel = { x: b.vel.x + (d.x / l) * pull, y: b.vel.y + (d.y / l) * pull };
}

// Returns the impact speed if the ball hit the wall, else 0.
function bounceOffWall(b: Ball, w: Segment): number {
  const c = closestOnSegment(b.pos, w.a, w.b);
  const d = sub(b.pos, c);
  const l = len(d);
  if (l >= R || l === 0) return 0;
  const n = scale(d, 1 / l);
  b.pos = { x: c.x + n.x * R, y: c.y + n.y * R };
  const vn = dot(b.vel, n);
  if (vn >= 0) return 0;
  const tangent = sub(b.vel, scale(n, vn));
  b.vel = sub(scale(tangent, P.wallScrub), scale(n, vn * P.wallBounce));
  return -vn;
}

// Equal masses. Returns the closing speed if they hit, else 0.
function collideBalls(a: Ball, b: Ball): number {
  const d = sub(b.pos, a.pos);
  const l = len(d);
  if (l >= R * 2 || l === 0) return 0;
  const n = scale(d, 1 / l);
  const push = (R * 2 - l) / 2;
  a.pos = sub(a.pos, scale(n, push));
  b.pos = { x: b.pos.x + n.x * push, y: b.pos.y + n.y * push };
  const closing = dot(sub(a.vel, b.vel), n);
  if (closing <= 0) return 0;
  const j = (closing * (1 + P.ballBounce)) / 2;
  a.vel = sub(a.vel, scale(n, j));
  b.vel = { x: b.vel.x + n.x * j, y: b.vel.y + n.y * j };
  return closing;
}

// Run until everything stops (or a safety limit). Used by tests and, later,
// by the host to settle a shot without rendering it.
export function settle(course: Course, balls: Ball[], maxSeconds = 30): PhysicsEvent[] {
  const events: PhysicsEvent[] = [];
  for (let t = 0; t < maxSeconds && !atRest(balls); t += P.step) {
    events.push(...step(course, balls));
  }
  return events;
}
