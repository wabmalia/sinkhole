import type { Course } from '../engine/physics';
import { inside, type Vec } from '../engine/vec';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// A hole is a walled floor (an outline polygon), optional solid blocks inside
// it, a tee mat where the first shot is placed, and the cup. On top of that,
// optional elements that act on a rolling ball.
export interface Hole {
  name: string;
  par: number;
  outline: Vec[];       // clockwise or not, closed implicitly
  blocks: Vec[][];      // solid polygons inside the outline
  tee: Rect;
  cup: Vec;
  ramps: Ramp[];
  rivers: Vec[][];      // slow the ball hard; stop in one and it goes back, +1 stroke
  wells: Well[];
  portals: Portal[];
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
  shapes.forEach((poly, k) => {
    const others = shapes.filter((_, j) => j !== k);
    const pieces: Vec[][] = [];
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length]!;
      const cuts = [0, 1, ...others.flatMap(o => o.map((c, j) => crossAt(a, b, c, o[(j + 1) % o.length]!)))]
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
  return wallLines(hole.outline, hole.blocks).flatMap(line => line.slice(1).map((b, i) => ({ a: line[i]!, b })));
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

// What the physics needs from a hole.
export function courseFrom(hole: Hole): Course {
  return { walls: wallsOf(hole), cup: hole.cup, ramps: hole.ramps, rivers: hole.rivers, wells: hole.wells, portals: hole.portals };
}
