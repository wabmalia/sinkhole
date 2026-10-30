import { CONFIG } from '../config';
import { inside } from '../holes/format';
import type { Portal, PortalColor, Ramp, Segment, Well } from '../holes/types';
import { closestOnSegment, dist, dot, fromAngle, len, lerp, scale, sub, type Vec } from './vec';

export interface Ball {
  id: number;
  pos: Vec;
  vel: Vec;
  sunk: boolean;
  from?: Vec;           // where this shot started; a ball that sinks in a river goes back here
  through?: string;     // the portal it just came out of ("pink:b"), until it leaves it
}

export interface Course {
  walls: Segment[];
  cup: Vec;
  ramps: Ramp[];
  rivers: Vec[][];
  wells: Well[];
  portals: Portal[];
}

// What happened during a step, so the scene can flash and spark.
export type PhysicsEvent =
  | { type: 'wall'; ball: number; at: Vec; speed: number }
  | { type: 'ball'; a: number; b: number; at: Vec; speed: number }
  | { type: 'sunk'; ball: number }
  | { type: 'portal'; ball: number; from: Vec; to: Vec; color: PortalColor }
  | { type: 'reset'; ball: number; at: Vec; cause: 'river' | 'blackHole' };

const P = CONFIG.physics;
const R = CONFIG.ball.radius;
const F = CONFIG.features;

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
    // Ramps and wells push; a push no stronger than rolling resistance can't
    // move a ball that has stopped, like a gentle slope.
    const push = pushOn(course, b.pos);
    b.vel = { x: b.vel.x + push.x * dt, y: b.vel.y + push.y * dt };
    const speed = len(b.vel);
    if (speed === 0) continue;

    // Rolling resistance plus drag, never reversing the ball. Rivers drag
    // much harder, like water: the faster the ball, the harder.
    const wet = course.rivers.some(r => inside(b.pos, r));
    const water = wet ? F.riverDrag + F.riverResist * speed : 0;
    const slow = (P.rolling + P.drag * speed + water) * dt;
    if (speed - slow <= P.stopSpeed && len(push) <= P.rolling) {
      b.vel = { x: 0, y: 0 };
    } else {
      b.vel = scale(b.vel, Math.max(0, speed - slow) / speed);
    }

    cupSlope(course.cup, b, dt);
    b.pos = { x: b.pos.x + b.vel.x * dt, y: b.pos.y + b.vel.y * dt };
  }

  // Balls in contact with something, which may be pushed against it.
  const touching = new Set<Ball>();
  for (const b of live) {
    for (const w of course.walls) {
      const hit = bounceOffWall(b, w);
      if (hit >= 0) touching.add(b);
      if (hit > 0) events.push({ type: 'wall', ball: b.id, at: { ...b.pos }, speed: hit });
    }
  }

  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const hit = collideBalls(live[i]!, live[j]!);
      if (hit >= 0) touching.add(live[i]!).add(live[j]!);
      if (hit > 0) {
        const at = scale({ x: live[i]!.pos.x + live[j]!.pos.x, y: live[i]!.pos.y + live[j]!.pos.y }, 0.5);
        events.push({ type: 'ball', a: live[i]!.id, b: live[j]!.id, at, speed: hit });
      }
    }
  }

  // A ball a ramp or well keeps pressing into a wall (or another ball) would
  // otherwise twitch for ever: once it's that slow, it has stopped.
  for (const b of touching) {
    if (len(b.vel) <= P.stopSpeed) b.vel = { x: 0, y: 0 };
  }

  for (const b of live) {
    // A ball that has all but stopped in a river sank in it.
    const cause = len(b.vel) < F.riverSink && course.rivers.some(r => inside(b.pos, r))
      ? 'river'
      : course.wells.some(w => w.kind === 'black' && dist(b.pos, w.at) < F.coreRadius)
        ? 'blackHole'
        : null;
    if (cause) {
      // Back to where the shot started; the game adds the penalty.
      events.push({ type: 'reset', ball: b.id, at: { ...b.pos }, cause });
      b.pos = { ...(b.from ?? b.pos) };
      b.vel = { x: 0, y: 0 };
      b.through = undefined;
      continue;
    }
    throughPortal(course, b, events);
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

// The ramps' and wells' push at a point, in units/s².
export function pushOn(course: Course, at: Vec): Vec {
  let x = 0;
  let y = 0;
  for (const r of course.ramps) {
    if (!inside(at, r.area)) continue;
    const dir = fromAngle((r.angle * Math.PI) / 180, r.strength);
    x += dir.x;
    y += dir.y;
  }
  for (const w of course.wells) {
    const d = sub(w.at, at);
    const l = len(d);
    if (l === 0 || l >= w.radius) continue;
    // Strongest at the centre, nothing at the edge.
    const k = ((w.kind === 'black' ? 1 : -1) * w.strength * (1 - l / w.radius)) / l;
    x += d.x * k;
    y += d.y * k;
  }
  return { x, y };
}

// In at one portal, out of its twin with the same velocity. The ball can't
// go back in until it has rolled clear of the portal it came out of.
function throughPortal(course: Course, b: Ball, events: PhysicsEvent[]) {
  if (b.through) {
    const [color, end] = b.through.split(':');
    const p = course.portals.find(q => q.color === color);
    const exit = p && (end === 'a' ? p.a : p.b);
    if (exit && dist(b.pos, exit) < F.portalRadius + R) return;
    b.through = undefined;
  }
  for (const p of course.portals) {
    for (const [entry, exit, end] of [[p.a, p.b, 'b'], [p.b, p.a, 'a']] as const) {
      if (dist(b.pos, entry) >= F.portalRadius) continue;
      events.push({ type: 'portal', ball: b.id, from: { ...b.pos }, to: { ...exit }, color: p.color });
      b.pos = { ...exit };
      b.through = `${p.color}:${end}`;
      return;
    }
  }
}

// Returns the impact speed if the ball hit the wall, 0 if it only touched
// it, and -1 if it's clear of it.
function bounceOffWall(b: Ball, w: Segment): number {
  const c = closestOnSegment(b.pos, w.a, w.b);
  const d = sub(b.pos, c);
  const l = len(d);
  if (l >= R || l === 0) return -1;
  const n = scale(d, 1 / l);
  b.pos = { x: c.x + n.x * R, y: c.y + n.y * R };
  const vn = dot(b.vel, n);
  if (vn >= 0) return 0;
  const tangent = sub(b.vel, scale(n, vn));
  b.vel = sub(scale(tangent, P.wallScrub), scale(n, vn * P.wallBounce));
  return -vn;
}

// Equal masses. Returns the closing speed if they hit, 0 if they only
// touched, and -1 if they're apart.
function collideBalls(a: Ball, b: Ball): number {
  const d = sub(b.pos, a.pos);
  const l = len(d);
  if (l >= R * 2 || l === 0) return -1;
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
