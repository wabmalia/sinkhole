import type { Course } from '../engine/physics';
import type { Vec } from '../engine/vec';

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
  rivers: Vec[][];      // touch one and the ball goes back, +1 stroke
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

// Every wall edge of a hole, outline and blocks alike.
export function wallsOf(hole: Hole): Segment[] {
  const out: Segment[] = [];
  for (const poly of [hole.outline, ...hole.blocks]) {
    poly.forEach((a, i) => out.push({ a, b: poly[(i + 1) % poly.length]! }));
  }
  return out;
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
