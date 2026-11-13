import type { Course } from '../engine/physics';
import { inside, type Vec } from '../engine/vec';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// A hole is a walled floor (an outline polygon), optional solid blocks inside
// it, a tee mat where the ball is placed, and the cup. On top of that,
// optional elements that act on a rolling ball.
export interface Hole {
  name: string;
  par: number;
  outline: Vec[];       // clockwise or not, closed implicitly
  blocks: Block[];      // solid shapes inside the outline: polygons or round
  tee: Rect;
  cup: Vec;
  ramps: Ramp[];
  rivers: Vec[][];      // slow the ball hard; stop in one and it goes back, +1 stroke
  mud: Vec[][];         // slow the ball almost as hard, but it stays where it stops
  wells: Well[];
  portals: Portal[];
}

// A round block: a post, a peg, a pillar.
export interface Round {
  at: Vec;
  radius: number;
}

// A cornered block made smooth: a curve through its corners.
export interface Smooth {
  smooth: Vec[];
}

export type Block = Vec[] | Round | Smooth;

export const isRound = (b: Block): b is Round => !Array.isArray(b) && 'radius' in b;
export const isSmooth = (b: Block): b is Smooth => !Array.isArray(b) && 'smooth' in b;
// The corners a block was drawn with, cornered or smooth; none for a circle.
export const cornersOf = (b: Block): Vec[] | null => (Array.isArray(b) ? b : isSmooth(b) ? b.smooth : null);

// The walls and the physics only know polygons: a round block is a polygon
// with enough sides that it plays and looks round (bigger ones get more), a
// smooth one a curve through its corners.
export function solid(b: Block): Vec[] {
  if (Array.isArray(b)) return b;
  if (isSmooth(b)) return curveThrough(b.smooth);
  const n = Math.min(40, Math.max(16, Math.round(b.radius / 2)));
  return Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2;
    return { x: b.at.x + Math.cos(a) * b.radius, y: b.at.y + Math.sin(a) * b.radius };
  });
}

export const solids = (blocks: Block[]): Vec[][] => blocks.map(solid);

// A closed curve through every corner (centripetal Catmull-Rom, which
// doesn't loop or overshoot between corners that are close together), in
// short straight steps, at most about 96 of them.
export function curveThrough(pts: Vec[]): Vec[] {
  const n = pts.length;
  const out: Vec[] = [];
  const most = Math.max(2, Math.floor(96 / n));
  const knot = (a: Vec, b: Vec) => Math.max(1e-3, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
  const mix = (a: Vec, b: Vec, ta: number, tb: number, t: number): Vec => {
    const k = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  };
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    const t1 = knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const steps = Math.min(most, Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 8)));
    for (let s = 0; s < steps; s++) {
      const t = t1 + ((t2 - t1) * s) / steps;
      const a1 = mix(p0, p1, 0, t1, t);
      const a2 = mix(p1, p2, t1, t2, t);
      const a3 = mix(p2, p3, t2, t3, t);
      out.push(mix(mix(a1, a2, 0, t2, t), mix(a2, a3, t1, t3, t), t1, t2, t));
    }
  }
  return out;
}

// Sloping ground: pushes the ball downhill, towards `angle` (degrees, 0 is
// right, 90 is down the screen). How steep is `strength`, in units/s².
export interface Ramp {
  area: Vec[];
  angle: number;
  strength: number;
}

// A black hole pulls the ball in, hardest at the centre, and swallows it at
// its core (like a river). A white hole pushes it out.
export interface Well {
  kind: 'black' | 'white';
  at: Vec;
  radius: number;
  strength: number;     // units/s² at the centre, fading to 0 at the radius
}

export const PORTAL_COLORS = ['pink', 'lime', 'orange', 'red'] as const;
export type PortalColor = (typeof PORTAL_COLORS)[number];

// Two linked portals: in at one, out of the other at the same speed and
// heading. One pair per colour.
export interface Portal {
  color: PortalColor;
  a: Vec;
  b: Vec;
}

export interface Segment {
  a: Vec;
  b: Vec;
}

// The walls a ball can actually meet, as lines to draw. Blocks may overlap
// the outline and each other, so every edge is cut where it crosses another
// shape, and a piece is kept only if it has open floor on exactly one side.
// That drops block edges outside the course, outline hidden under a block,
// edges inside other blocks, and edges lying along another wall with solid
// on both sides (a block filling a corner). A shape whose edge survives whole
// comes back as a closed loop (first point repeated at the end).
export function wallLines(outline: Vec[], blocks: Vec[][]): Vec[][] {
  const shapes = [outline, ...blocks];
  const lines: Vec[][] = [];
  const floor = (p: Vec) => inside(p, outline) && !blocks.some(b => inside(p, b));
  // Each shape's box, so an edge skips the shapes nowhere near it: with many
  // small blocks (pegs) that's most of them.
  const boxes = shapes.map(bounds);
  shapes.forEach((poly, k) => {
    const near = (a: Vec, b: Vec) => (o: Rect) =>
      Math.max(a.x, b.x) >= o.x && Math.min(a.x, b.x) <= o.x + o.w && Math.max(a.y, b.y) >= o.y && Math.min(a.y, b.y) <= o.y + o.h;
    const others = shapes.filter((_, j) => j !== k);
    const otherBoxes = boxes.filter((_, j) => j !== k);
    const pieces: Vec[][] = [];
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length]!;
      const hit = near(a, b);
      const cuts = [0, 1, ...others.flatMap((o, n) => (hit(otherBoxes[n]!) ? o.map((c, j) => crossAt(a, b, c, o[(j + 1) % o.length]!)) : []))]
        .filter((t): t is number => t !== null)
        .sort((x, y) => x - y);
      for (let n = 0; n + 1 < cuts.length; n++) {
        const t0 = cuts[n]!;
        const t1 = cuts[n + 1]!;
        if (t1 - t0 < 1e-9) continue;
        const at = (t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        // Half a unit either side of the piece's middle.
        const m = at((t0 + t1) / 2);
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        const side = { x: (-(b.y - a.y) / l) * 0.5, y: ((b.x - a.x) / l) * 0.5 };
        if (floor({ x: m.x + side.x, y: m.y + side.y }) === floor({ x: m.x - side.x, y: m.y - side.y })) continue;
        const last = pieces[pieces.length - 1];
        const p0 = at(t0);
        const end = last?.[last.length - 1];
        if (end && Math.abs(end.x - p0.x) < 1e-6 && Math.abs(end.y - p0.y) < 1e-6) last!.push(at(t1));
        else pieces.push([p0, at(t1)]);
      }
    });
    // The last piece may run on into the first, round the shape's start.
    const first = pieces[0];
    const last = pieces[pieces.length - 1];
    if (first && last && pieces.length > 1 && same(last[last.length - 1]!, first[0]!)) {
      pieces[0] = [...last, ...first.slice(1)];
      pieces.pop();
    }
    lines.push(...pieces);
  });
  return lines;
}

// Every wall segment the physics checks.
export function wallsOf(hole: Hole): Segment[] {
  return wallLines(hole.outline, solids(hole.blocks)).flatMap(line => line.slice(1).map((b, i) => ({ a: line[i]!, b })));
}

const same = (p: Vec, q: Vec) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;

// Where along a-b (0 to 1) it crosses c-d, if it does.
function crossAt(a: Vec, b: Vec, c: Vec, d: Vec): number | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (den === 0) return null;
  const qp = { x: c.x - a.x, y: c.y - a.y };
  const t = (qp.x * s.y - qp.y * s.x) / den;
  const u = (qp.x * r.y - qp.y * r.x) / den;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
}

export function bounds(points: Vec[]): Rect {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// Is the point on the rect (edges included)? The ball is on the tee mat when
// its centre is.
export const onRect = (p: Vec, r: Rect): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

// What the physics needs from a hole.
export function courseFrom(hole: Hole): Course {
  return {
    walls: wallsOf(hole), cup: hole.cup, tee: hole.tee,
    ramps: hole.ramps, rivers: hole.rivers, mud: hole.mud, wells: hole.wells, portals: hole.portals,
  };
}
