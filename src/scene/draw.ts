import type Phaser from 'phaser';
import { COLORS, CONFIG } from '../config';
import type { Vec } from '../engine/vec';
import { bounds, type Hole } from '../holes/types';

const GRID = 30;

// The parts of the course that never move, drawn once.
export function drawCourse(g: Phaser.GameObjects.Graphics, hole: Hole) {
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
  g.fillPoints(pts(hole.outline), true);
  g.lineStyle(1, COLORS.gridBright, 0.7);
  for (let x = b.x + GRID; x < b.x + b.w; x += GRID) {
    for (const [y0, y1] of spans(hole.outline, x, 'x')) g.lineBetween(x, y0, x, y1);
  }
  for (let y = b.y + GRID; y < b.y + b.h; y += GRID) {
    for (const [x0, x1] of spans(hole.outline, y, 'y')) g.lineBetween(x0, y, x1, y);
  }

  // Rivers and ramps sit on the floor; their moving parts are drawn by the
  // scene each frame.
  for (const river of hole.rivers) {
    g.fillStyle(COLORS.river, 0.14);
    g.fillPoints(pts(river), true);
    g.lineStyle(1.5, COLORS.river, 0.7);
    g.strokePoints(pts(river), true, true);
  }
  for (const ramp of hole.ramps) {
    g.fillStyle(COLORS.ramp, 0.06);
    g.fillPoints(pts(ramp.area), true);
    g.lineStyle(1, COLORS.ramp, 0.35);
    g.strokePoints(pts(ramp.area), true, true);
  }
  // How far each well reaches.
  for (const w of hole.wells) {
    g.lineStyle(1, w.kind === 'black' ? COLORS.blackHole : COLORS.whiteHole, 0.25);
    g.strokeCircle(w.at.x, w.at.y, w.radius);
  }

  for (const block of hole.blocks) {
    g.fillStyle(COLORS.bg, 1);
    g.fillPoints(pts(block), true);
  }

  // Tee mat.
  const t = hole.tee;
  g.fillStyle(COLORS.mat, 0.12);
  g.fillRect(t.x, t.y, t.w, t.h);
  g.lineStyle(1.5, COLORS.mat, 0.8);
  const c = 10;
  for (const [x, y, sx, sy] of [[t.x, t.y, 1, 1], [t.x + t.w, t.y, -1, 1], [t.x, t.y + t.h, 1, -1], [t.x + t.w, t.y + t.h, -1, -1]] as const) {
    g.lineBetween(x, y, x + c * sx, y);
    g.lineBetween(x, y, x, y + c * sy);
  }

  // Cup.
  const cup = hole.cup;
  const r = CONFIG.cup.radius;
  g.fillStyle(COLORS.cup, 0.12);
  g.fillCircle(cup.x, cup.y, r + 7);
  g.fillStyle(COLORS.hole, 1);
  g.fillCircle(cup.x, cup.y, r);
  g.lineStyle(2, COLORS.cup, 1);
  g.strokeCircle(cup.x, cup.y, r);

  // Neon walls: a wide faint glow, a narrower one, then the hot core.
  for (const poly of [hole.outline, ...hole.blocks]) {
    g.lineStyle(10, COLORS.wall, 0.1);
    g.strokePoints(pts(poly), true, true);
    g.lineStyle(5, COLORS.wall, 0.3);
    g.strokePoints(pts(poly), true, true);
    g.lineStyle(2, COLORS.wallCore, 1);
    g.strokePoints(pts(poly), true, true);
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

// Graphics takes plain {x, y} points at runtime, but is typed for Vector2.
const pts = (poly: Vec[]) => poly as unknown as Phaser.Math.Vector2[];
