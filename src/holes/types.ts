import type { Vec } from '../engine/vec';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// A hole is a walled floor (an outline polygon), optional solid blocks inside
// it, a tee mat where the first shot is placed, and the cup.
export interface Hole {
  name: string;
  par: number;
  outline: Vec[];       // clockwise or not, closed implicitly
  blocks: Vec[][];      // solid polygons inside the outline
  tee: Rect;
  cup: Vec;
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
