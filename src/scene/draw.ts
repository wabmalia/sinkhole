import { COLORS, CONFIG } from '../config';
import { dist, type Vec } from '../engine/vec';
import { bounds, wallLines, type Hole, type Rect } from '../holes/types';
import type { Pen } from './pen';

// The parts of a hole that never move. The game draws them all once per
// hole; the editor redraws the pieces it shares (zones, tee, cup, walls)
// under its own grid and handles.

const GRID = 30;

export function drawCourse(g: Pen, hole: Hole) {
  const b = bounds(hole.outline);

  // The void around the course, with a faint grid running off to the edges.
  const margin = 2000;
  g.lineStyle(1, COLORS.grid, 0.6);
  for (let x = b.x - margin; x <= b.x + b.w + margin; x += GRID * 2) {
    g.lineBetween(x, b.y - margin, x, b.y + b.h + margin);
  }
  for (let y = b.y - margin; y <= b.y + b.h + margin; y += GRID * 2) {
    g.lineBetween(b.x - margin, y, b.x + b.w + margin, y);
  }

  // Floor, and a brighter grid clipped to it.
  g.fillStyle(COLORS.floor, 1);
  g.fillPoints(hole.outline, true);
  g.lineStyle(1, COLORS.gridBright, 0.7);
  for (let x = b.x + GRID; x < b.x + b.w; x += GRID) {
    for (const [y0, y1] of spans(hole.outline, x, 'x')) g.lineBetween(x, y0, x, y1);
  }
  for (let y = b.y + GRID; y < b.y + b.h; y += GRID) {
    for (const [x0, x1] of spans(hole.outline, y, 'y')) g.lineBetween(x0, y, x1, y);
  }

  drawZones(g, hole);
  for (const block of hole.blocks) {
    g.fillStyle(COLORS.bg, 1);
    g.fillPoints(block, true);
  }
  drawTee(g, hole.tee);
  drawCup(g, hole.cup);
  drawWalls(g, hole.outline, hole.blocks);
}

// Rivers and ramps sit on the floor, and each well's reach is a faint ring;
// their moving parts are in elements.ts.
export function drawZones(g: Pen, hole: Pick<Hole, 'rivers' | 'ramps' | 'wells'>) {
  for (const river of hole.rivers) {
    g.fillStyle(COLORS.river, 0.14);
    g.fillPoints(river, true);
    g.lineStyle(1.5, COLORS.river, 0.7);
    g.strokePoints(river, true, true);
  }
  for (const ramp of hole.ramps) {
    g.fillStyle(COLORS.ramp, 0.06);
    g.fillPoints(ramp.area, true);
    g.lineStyle(1, COLORS.ramp, 0.35);
    g.strokePoints(ramp.area, true, true);
  }
  for (const w of hole.wells) {
    g.lineStyle(1, w.kind === 'black' ? COLORS.blackHole : COLORS.whiteHole, 0.25);
    g.strokeCircle(w.at.x, w.at.y, w.radius);
  }
}

// The tee mat, marked at its corners.
export function drawTee(g: Pen, t: Rect) {
  g.fillStyle(COLORS.mat, 0.12);
  g.fillRect(t.x, t.y, t.w, t.h);
  g.lineStyle(1.5, COLORS.mat, 0.8);
  const c = 10;
  for (const [x, y, sx, sy] of [[t.x, t.y, 1, 1], [t.x + t.w, t.y, -1, 1], [t.x, t.y + t.h, 1, -1], [t.x + t.w, t.y + t.h, -1, -1]] as const) {
    g.lineBetween(x, y, x + c * sx, y);
    g.lineBetween(x, y, x, y + c * sy);
  }
}

export function drawCup(g: Pen, cup: Vec) {
  const r = CONFIG.cup.radius;
  g.fillStyle(COLORS.cup, 0.12);
  g.fillCircle(cup.x, cup.y, r + 7);
  g.fillStyle(COLORS.hole, 1);
  g.fillCircle(cup.x, cup.y, r);
  g.lineStyle(2, COLORS.cup, 1);
  g.strokeCircle(cup.x, cup.y, r);
}

// Neon walls: a wide faint glow, a narrower one, then the hot core. Only
// the parts that border the floor, where blocks overlap the outline.
export function drawWalls(g: Pen, outline: Vec[], blocks: Vec[][]) {
  for (const line of wallLines(outline, blocks)) {
    const closed = line.length > 3 && dist(line[0]!, line[line.length - 1]!) < 1e-6;
    const points = closed ? line.slice(0, -1) : line;
    for (const [width, color, alpha] of [[10, COLORS.wall, 0.1], [5, COLORS.wall, 0.3], [2, COLORS.wallCore, 0.75]] as const) {
      g.lineStyle(width, color, alpha);
      g.strokePoints(points, closed, closed);
    }
  }
}

// Where a vertical (axis 'x') or horizontal (axis 'y') line at `at` crosses
// the inside of a polygon, as pairs of start and end coordinates.
function spans(poly: Vec[], at: number, axis: 'x' | 'y'): [number, number][] {
  const hits: number[] = [];
  const u = (p: Vec) => (axis === 'x' ? p.x : p.y);
  const v = (p: Vec) => (axis === 'x' ? p.y : p.x);
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    if ((u(a) <= at) !== (u(b) <= at)) {
      hits.push(v(a) + ((at - u(a)) / (u(b) - u(a))) * (v(b) - v(a)));
    }
  });
  hits.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < hits.length; i += 2) out.push([hits[i]!, hits[i + 1]!]);
  return out;
}
