import { CONFIG } from '../config';
import { inside } from '../holes/format';
import { onRect, type Portal, type PortalColor, type Ramp, type Rect, type Segment, type Well } from '../holes/types';
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
  tee: Rect;            // balls on the mat pass through each other
  ramps: Ramp[];
  rivers: Vec[][];
  mud: Vec[][];
  wells: Well[];
  portals: Portal[];
}

// What happened during a step, so the scene can flash and spark.
export type PhysicsEvent =
  | { type: 'wall'; ball: number; at: Vec; speed: number }
  | { type: 'ball'; a: number; b: number; at: Vec; speed: number }
  | { type: 'sunk'; ball: number }
  | { type: 'portal'; ball: number; from: Vec; to: Vec; color: PortalColor }
  | { type: 'reset'; ball: number; at: Vec; cause: 'river' | 'blackHole' | 'timeout' };

const P = CONFIG.physics;
const R = CONFIG.ball.radius;
const F = CONFIG.features;

// A shot is timed in physics steps, not on the clock, so the host and every
// screen call it off at exactly the same point.
export const HOURGLASS_STEPS = Math.round(CONFIG.rules.hourglassAfter / P.step);
export const TIMEOUT_STEPS = Math.round(CONFIG.rules.shotTimeout / P.step);

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
  // How hard a ramp or well presses each ball this step: a ball meeting a
  // wall or another ball no faster than this is resting on it, not bouncing.
  const pressing = new Map<Ball, number>();
  // The push on each ball and the most of it the ground can hold back.
  const pushes = new Map<Ball, Vec>();
  const holds = new Map<Ball, number>();

  for (const b of live) {
    // Ramps and wells push; a push no stronger than rolling resistance can't
    // move a ball that has stopped, like a gentle slope. Nor can one only a
    // little stronger: it could never get the ball past stopSpeed, so it
    // would creep along unseen and the shot would never end.
    const push = pushOn(course, b.pos);
    const muddy = course.mud.some(m => inside(b.pos, m));
    const hold = P.rolling + P.drag * P.stopSpeed + (muddy ? F.mudDrag : 0);
    pressing.set(b, len(push) * dt * P.restPress + P.stopSpeed);
    pushes.set(b, push);
    holds.set(b, hold);
    b.vel = { x: b.vel.x + push.x * dt, y: b.vel.y + push.y * dt };
    const speed = len(b.vel);
    if (speed === 0) continue;

    // Rolling resistance plus drag, never reversing the ball. Rivers drag
    // much harder, like water: the faster the ball, the harder. Mud drags
    // too, a little less, and holds a ball against a gentle ramp.
    const wet = course.rivers.some(r => inside(b.pos, r));
    const water = wet ? F.riverDrag + F.riverResist * speed : 0;
    const mud = muddy ? F.mudDrag + F.mudResist * speed : 0;
    const slow = (P.rolling + P.drag * speed + water + mud) * dt;
    if (speed - slow <= P.stopSpeed && len(push) <= hold) {
      b.vel = { x: 0, y: 0 };
    } else if (speed > slow) {
      b.vel = scale(b.vel, (speed - slow) / speed);
    } else {
      // Stopped for an instant at the top of its roll up a slope, and the
      // slope sets it going back down.
      b.vel = scale(push, ((len(push) - hold) * dt) / len(push));
    }

    cupSlope(course.cup, b, dt);
    b.pos = { x: b.pos.x + b.vel.x * dt, y: b.pos.y + b.vel.y * dt };
  }

  // Balls in contact with something, which may be pushed against it, and
  // which way each contact faces (away from what it touches).
  const touching = new Set<Ball>();
  const contacts = new Map<Ball, Contact[]>();
  const contact = (b: Ball, n: Vec, wall: boolean) => {
    touching.add(b);
    contacts.set(b, [...(contacts.get(b) ?? []), { n, wall }]);
  };
  const walls = (report: boolean) => {
    for (const b of live) {
      for (const w of course.walls) {
        const hit = bounceOffWall(b, w, pressing.get(b)!, n => contact(b, n, true));
        if (hit > 0 && report) events.push({ type: 'wall', ball: b.id, at: { ...b.pos }, speed: hit });
      }
    }
  };
  walls(true);

  // Balls don't hit each other on the tee mat, so a ball left there never
  // gets in the way of the next tee shot.
  const onTee = (b: Ball) => onRect(b.pos, course.tee);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      if (onTee(live[i]!) || onTee(live[j]!)) continue;
      const rest = Math.max(pressing.get(live[i]!)!, pressing.get(live[j]!)!);
      const hit = collideBalls(live[i]!, live[j]!, rest, n => {
        contact(live[i]!, scale(n, -1), false);
        contact(live[j]!, n, false);
      });
      if (hit > 0) {
        const at = scale({ x: live[i]!.pos.x + live[j]!.pos.x, y: live[i]!.pos.y + live[j]!.pos.y }, 0.5);
        events.push({ type: 'ball', a: live[i]!.id, b: live[j]!.id, at, speed: hit });
      }
    }
  }

  // Balls pushed apart may have been pushed into a wall: put them back on
  // the right side of it before it's crossed.
  walls(false);

  // A ball a ramp or well keeps pressing into a wall (or into a pile of
  // balls) would otherwise twitch for ever: once it's that slow, and what's
  // left of the push once the contacts take their share can't move it, it
  // has stopped. A ball only slow for a moment, at the top of its roll back
  // up a slope beside a wall, still has a push to move it, and keeps going.
  // Pressed into a wall, a ball rubs along it, the harder the more it's
  // pressed: a push almost straight into the wall holds it there instead of
  // leaving it creeping along for ever.
  for (const b of touching) {
    const { left, grip } = pressedBy(pushes.get(b)!, contacts.get(b)!);
    const free = len(left) - holds.get(b)! - grip;
    if (len(b.vel) <= pressing.get(b)! && free <= 0) {
      b.vel = { x: 0, y: 0 };
    } else if (grip > 0) {
      const speed = len(b.vel);
      const rub = grip * dt;
      // Rubbed to a stop, but pushed harder than it grips: it sets off again.
      b.vel = speed > rub
        ? scale(b.vel, (speed - rub) / speed)
        : free > 0 ? scale(left, (free * dt) / len(left)) : { x: 0, y: 0 };
    }
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

  // A ball right over the middle drops in at a faster pace than one
  // clipping the edge, which needs to be slower.
  const capture = CONFIG.cup.radius + CONFIG.cup.captureSlack;
  for (const b of live) {
    const d = dist(b.pos, course.cup);
    const centred = 1 + (CONFIG.cup.captureCentre - 1) * Math.max(0, 1 - d / capture);
    if (d < capture && len(b.vel) <= CONFIG.cup.captureSpeed * centred) {
      b.sunk = true;
      b.pos = { ...course.cup };
      b.vel = { x: 0, y: 0 };
      events.push({ type: 'sunk', ball: b.id });
    }
  }

  return events;
}

interface Contact {
  n: Vec;               // unit normal, out of the wall or other ball
  wall: boolean;
}

// What's left of a push once each contact takes the part going into it,
// and how hard the walls grip the ball for being pressed in, in units/s².
function pressedBy(push: Vec, contacts: Contact[]): { left: Vec; grip: number } {
  let f = push;
  let grip = 0;
  // Twice round, for a ball wedged between two contacts.
  for (let pass = 0; pass < 2; pass++) {
    for (const { n, wall } of contacts) {
      const into = dot(f, n);
      if (into >= 0) continue;
      f = sub(f, scale(n, into));
      if (wall) grip -= into * P.wallGrip;
    }
  }
  return { left: f, grip };
}

// The ground dips into the cup: once the ball overlaps it, it is pulled in,
// and a little just before, fading in, so a near miss can still curl in. A
// slow ball curls in, a fast one lips out.
function cupSlope(cup: Vec, b: Ball, dt: number) {
  const d = sub(cup, b.pos);
  const l = len(d);
  const touch = CONFIG.cup.radius + R;
  const reach = CONFIG.cup.pullReach;
  if (l === 0 || l > touch + reach) return;
  const pull = CONFIG.cup.pull * dt * Math.min(1, (touch + reach - l) / reach);
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
// it, and -1 if it's clear of it. A ball coming in no faster than `rest` is
// being pressed into the wall: it stays against it instead of bouncing, or
// a strong ramp or well would bounce it off and back in for ever.
function bounceOffWall(b: Ball, w: Segment, rest: number, touch: (n: Vec) => void): number {
  const c = closestOnSegment(b.pos, w.a, w.b);
  const d = sub(b.pos, c);
  const l = len(d);
  if (l >= R || l === 0) return -1;
  const n = scale(d, 1 / l);
  touch(n);
  b.pos = { x: c.x + n.x * R, y: c.y + n.y * R };
  const vn = dot(b.vel, n);
  if (vn >= 0) return 0;
  const tangent = sub(b.vel, scale(n, vn));
  if (-vn <= rest) {
    b.vel = tangent;
    return 0;
  }
  b.vel = sub(scale(tangent, P.wallScrub), scale(n, vn * P.wallBounce));
  return -vn;
}

// Equal masses. Returns the closing speed if they hit, 0 if they only
// touched, and -1 if they're apart. Closing no faster than `rest`, they are
// pressed together and don't bounce apart.
function collideBalls(a: Ball, b: Ball, rest: number, touch: (n: Vec) => void): number {
  const d = sub(b.pos, a.pos);
  const l = len(d);
  if (l >= R * 2 || l === 0) return -1;
  const n = scale(d, 1 / l);
  touch(n);
  const push = (R * 2 - l) / 2;
  a.pos = sub(a.pos, scale(n, push));
  b.pos = { x: b.pos.x + n.x * push, y: b.pos.y + n.y * push };
  const closing = dot(sub(a.vel, b.vel), n);
  if (closing <= 0) return 0;
  const pressed = closing <= rest;
  const j = (closing * (1 + (pressed ? 0 : P.ballBounce))) / 2;
  a.vel = sub(a.vel, scale(n, j));
  b.vel = { x: b.vel.x + n.x * j, y: b.vel.y + n.y * j };
  return pressed ? 0 : closing;
}

// Run until everything stops (or a safety limit). Used by tests.
export function settle(course: Course, balls: Ball[], maxSeconds = 30): PhysicsEvent[] {
  const events: PhysicsEvent[] = [];
  const steps = Math.round(maxSeconds / P.step);
  for (let n = 0; n < steps && !atRest(balls); n++) {
    events.push(...step(course, balls));
  }
  return events;
}

// A whole shot, as the host plays it: run to rest, or call it off once it
// has run too long.
export function playOut(course: Course, balls: Ball[], steps = TIMEOUT_STEPS): PhysicsEvent[] {
  const events: PhysicsEvent[] = [];
  for (let n = 0; n < steps && !atRest(balls); n++) {
    events.push(...step(course, balls));
  }
  return [...events, ...timeOut(balls)];
}

// Call off a shot that has run too long: every ball still moving goes back
// to where the shot started, like out of bounds (the game adds the penalty).
export function timeOut(balls: Ball[]): PhysicsEvent[] {
  const events: PhysicsEvent[] = [];
  for (const b of balls) {
    if (b.sunk || (b.vel.x === 0 && b.vel.y === 0)) continue;
    events.push({ type: 'reset', ball: b.id, at: { ...b.pos }, cause: 'timeout' });
    b.pos = { ...(b.from ?? b.pos) };
    b.vel = { x: 0, y: 0 };
    b.through = undefined;
  }
  return events;
}
