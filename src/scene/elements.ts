import { COLORS, CONFIG, PORTAL_TINT } from '../config';
import { dist, fromAngle, type Vec } from '../engine/vec';
import { inside } from '../holes/format';
import { bounds, wallLines, type Hole } from '../holes/types';
import type { Pen } from './pen';

// The moving parts of a hole: light running along the walls, ramp chevrons,
// river hexes, well ripples and pixel portals. Where things go is worked out
// once per hole (`layout`); `drawMoving` redraws them every frame. The game
// and the editor both use these.

interface WallPath {
  points: Vec[];
  at: number[];         // distance along the path to each point
  length: number;
  closed: boolean;
}

interface RampMarks {
  dir: Vec;             // downhill
  start: Vec;           // where the chevron's point enters, on the uphill edge
  wing: Vec[];          // from the point to each arm's end, past the sides
  run: number;          // how far the point travels until the arms are out
}

interface Hex {
  at: Vec;
  period: number;       // seconds per pop
  phase: number;
  solid: boolean;
}

interface Pixel {
  x: number;
  y: number;
  r: number;
  angle: number;
}

export interface Layout {
  walls: WallPath[];
  ramps: RampMarks[];
  hexes: Hex[];
  links: [number, number][];
  pixels: Pixel[];
}

const HEX = 7;                // river hex radius
const PIXEL = 3;              // portal pixel size
const PULSE = { speed: 150, tail: 80, every: 420 };

// A fixed pseudo-random number in [0, 1) for each index, so the pattern is
// the same for everyone and every frame.
const hash = (n: number) => {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export function layout(hole: Pick<Hole, 'outline' | 'blocks' | 'ramps' | 'rivers'>): Layout {
  const walls = wallLines(hole.outline, hole.blocks).map(line => {
    const at = [0];
    for (let i = 1; i < line.length; i++) at.push(at[i - 1]! + dist(line[i - 1]!, line[i]!));
    const closed = line.length > 3 && dist(line[0]!, line[line.length - 1]!) < 1e-6;
    return { points: line, at, length: at[at.length - 1]!, closed };
  });

  // One big chevron per ramp, its arms reaching past both sides (they're cut
  // off at the edges), travelling the ramp from the uphill end to the bottom.
  const ramps = hole.ramps.map(r => {
    const a = (r.angle * Math.PI) / 180;
    const dir = fromAngle(a);
    const across = { x: -dir.y, y: dir.x };
    const along = r.area.map(p => p.x * dir.x + p.y * dir.y);
    const side = r.area.map(p => p.x * across.x + p.y * across.y);
    const [u0, u1] = [Math.min(...along), Math.max(...along)];
    const [v0, v1] = [Math.min(...side), Math.max(...side)];
    const half = (v1 - v0) / 2;
    const depth = Math.min(half * 0.6, (u1 - u0) * 0.5);
    const v = (v0 + v1) / 2;
    const start = { x: dir.x * u0 + across.x * v, y: dir.y * u0 + across.y * v };
    const reach = half * 1.6;
    const wing = [1, -1].map(k => ({ x: -dir.x * depth * 1.6 + across.x * reach * k, y: -dir.y * depth * 1.6 + across.y * reach * k }));
    return { dir, start, wing, run: u1 - u0 + depth * 1.6 + 16 };
  });

  // Hexes in rows, every other row shifted half a hex. Only whole ones, so
  // none spill over the river's edge.
  const hexes: Hex[] = [];
  const w = Math.sqrt(3) * HEX;
  for (const river of hole.rivers) {
    const b = bounds(river);
    for (let row = 0, y = b.y + HEX; y < b.y + b.h; row++, y += HEX * 1.5) {
      for (let x = b.x + w / 2 + (row % 2) * (w / 2); x < b.x + b.w; x += w) {
        const at = { x, y };
        if (!inside(at, river) || !hexCorners(at, HEX * 0.9).every(c => inside(c, river))) continue;
        const n = hexes.length;
        hexes.push({ at, period: 1.6 + 2.4 * hash(n), phase: hash(n + 0.5), solid: hash(n + 0.25) < 0.22 });
      }
    }
  }
  const links: [number, number][] = [];
  for (let i = 0; i < hexes.length; i++) {
    for (let j = i + 1; j < hexes.length; j++) {
      if (dist(hexes[i]!.at, hexes[j]!.at) < w * 1.05) links.push([i, j]);
    }
  }

  // The squares a portal is made of, from its centre, laid evenly round it.
  const pr = CONFIG.features.portalRadius;
  const pixels: Pixel[] = [];
  const n = Math.ceil((pr + PIXEL) / PIXEL);
  for (let i = -n; i < n; i++) {
    for (let j = -n; j < n; j++) {
      const cx = (i + 0.5) * PIXEL;
      const cy = (j + 0.5) * PIXEL;
      const r = Math.hypot(cx, cy);
      if (r <= pr + PIXEL * 0.7) pixels.push({ x: i * PIXEL, y: j * PIXEL, r, angle: Math.atan2(cy, cx) });
    }
  }

  return { walls, ramps, hexes, links, pixels };
}

// What moves: the hole as far as it's drawn (the editor's may have no cup
// yet).
export type Moving = Pick<Hole, 'ramps' | 'wells' | 'portals'> & { cup: Vec | null };

export function drawMoving(fx: Pen, hole: Moving, look: Layout, time: number) {
  if (hole.cup) drawCupBeat(fx, hole.cup, time);
  drawWalls(fx, look, time);
  drawRamps(fx, hole, look, time);
  drawRivers(fx, look, time);
  drawWells(fx, hole, time);
  drawPortals(fx, hole, look, time);
}

// The cup breathes.
function drawCupBeat(fx: Pen, cup: Vec, time: number) {
  const beat = (time % 1600) / 1600;
  fx.lineStyle(1.5, COLORS.cup, 0.5 * (1 - beat));
  fx.strokeCircle(cup.x, cup.y, CONFIG.cup.radius + 2 + beat * 14);
}

// Light runs along the walls, and now and then a spot on them glints.
function drawWalls(fx: Pen, look: Layout, time: number) {
  const s = time / 1000;
  look.walls.forEach((path, w) => {
    const pulses = Math.max(1, Math.round(path.length / PULSE.every));
    const run = path.closed ? path.length : path.length + PULSE.tail;
    for (let k = 0; k < pulses; k++) {
      const head = (s * PULSE.speed + (k * run) / pulses + hash(w) * run) % run;
      const step = 5;
      for (let d = 0; d < PULSE.tail; d += step) {
        const a = pointAt(path, head - d);
        const b = pointAt(path, head - d - step);
        if (!a || !b) continue;
        const fade = 1 - d / PULSE.tail;
        fx.lineStyle(8, COLORS.wall, 0.2 * fade);
        fx.lineBetween(a.x, a.y, b.x, b.y);
        fx.lineStyle(3, 0xffffff, fade * fade);
        fx.lineBetween(a.x, a.y, b.x, b.y);
      }
    }
    for (let d = 12, n = 0; d < path.length; d += 26, n++) {
      const glint = Math.max(0, Math.sin(s * (0.8 + hash(n + w * 97)) * 2 + hash(n * 3 + w) * 40)) ** 16;
      if (glint < 0.05) continue;
      const p = pointAt(path, d)!;
      fx.fillStyle(0xffffff, 0.8 * glint);
      fx.fillCircle(p.x, p.y, 1.8);
      fx.fillStyle(COLORS.wall, 0.25 * glint);
      fx.fillCircle(p.x, p.y, 5);
    }
  });
}

// Where `d` along a wall falls, wrapping round a closed one; null past the
// ends of an open one.
function pointAt(path: WallPath, d: number): Vec | null {
  if (path.closed) d = ((d % path.length) + path.length) % path.length;
  else if (d < 0 || d > path.length) return null;
  let i = 1;
  while (i < path.at.length - 1 && path.at[i]! < d) i++;
  const a = path.points[i - 1]!;
  const b = path.points[i]!;
  const span = path.at[i]! - path.at[i - 1]!;
  const k = span ? (d - path.at[i - 1]!) / span : 0;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

// One big chevron pointing downhill sweeps the ramp from top to bottom,
// pulsing as it goes. Steeper ramps sweep faster and stack more lines in it
// (one, two or three).
function drawRamps(fx: Pen, hole: Moving, look: Layout, time: number) {
  hole.ramps.forEach((ramp, i) => {
    const m = look.ramps[i];
    if (!m) return;
    const period = 2.6 - 1.6 * Math.min(1, Math.sqrt(ramp.strength / 12000));
    const s = time / 1000;
    const t = (s / period) % 1;
    const stack = ramp.strength < 1200 ? 1 : ramp.strength < 4000 ? 2 : 3;
    const beat = 0.5 + 0.5 * Math.sin(s * Math.PI * 2 * 3 / period);
    const chevron = (shift: number, width: number, alpha: number) => {
      for (let n = 0; n < stack; n++) {
        const along = shift - n * 8;
        const tip = { x: m.start.x + m.dir.x * along, y: m.start.y + m.dir.y * along };
        for (const w of m.wing) clipped(fx, ramp.area, tip, { x: tip.x + w.x, y: tip.y + w.y }, width, alpha * (1 - n * 0.25));
      }
    };
    const at = t * m.run;
    chevron(at, 9, 0.1 + 0.15 * beat);
    chevron(at, 2.5, 0.5 + 0.45 * beat);
  });
}

// A line, drawn only where it's inside the area.
function clipped(fx: Pen, area: Vec[], a: Vec, b: Vec, width: number, alpha: number) {
  const steps = Math.max(1, Math.ceil(dist(a, b) / 3));
  fx.lineStyle(width, COLORS.ramp, alpha);
  let prev: Vec | null = null;
  for (let k = 0; k <= steps; k++) {
    const p = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps };
    const ok = inside(p, area);
    if (ok && prev) fx.lineBetween(prev.x, prev.y, p.x, p.y);
    prev = ok ? p : null;
  }
}

// A data river: a mesh of hexes popping in and out, linked to whichever
// neighbours are showing.
function drawRivers(fx: Pen, look: Layout, time: number) {
  const s = time / 1000;
  const size = look.hexes.map(h => {
    const t = (s / h.period + h.phase) % 1;
    if (t > 0.6) return 0;
    if (t < 0.08) return backOut(t / 0.08);
    if (t > 0.5) return 1 - (t - 0.5) / 0.1;
    return 1;
  });
  for (const [i, j] of look.links) {
    const k = Math.min(size[i]!, size[j]!);
    if (k <= 0) continue;
    const a = look.hexes[i]!.at;
    const b = look.hexes[j]!.at;
    fx.lineStyle(1.2, COLORS.river, 0.55 * k);
    fx.lineBetween(a.x, a.y, b.x, b.y);
  }
  look.hexes.forEach((h, i) => {
    const k = size[i]!;
    if (k <= 0) return;
    const corners = hexCorners(h.at, HEX * 0.8 * k);
    if (h.solid) {
      fx.fillStyle(COLORS.river, 0.45 * Math.min(1, k));
      fx.fillPoints(corners, true);
    }
    fx.lineStyle(1, COLORS.river, 0.8 * Math.min(1, k));
    fx.strokePoints(corners, true, true);
  });
}

function hexCorners(at: Vec, r: number): Vec[] {
  return [0, 1, 2, 3, 4, 5].map(k => {
    const a = -Math.PI / 2 + (k * Math.PI) / 3;
    return { x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r };
  });
}

// Overshoots a little before settling, for a pop.
function backOut(t: number) {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

// Ripples all the way from the edge. A black hole's fall in and slow down
// as they reach the horizon, where they pile up; a white hole's burst out of
// the core and ease off towards the edge. Round the core, an accretion swirl.
function drawWells(fx: Pen, hole: Moving, time: number) {
  const core = CONFIG.features.coreRadius;
  const s = time / 1000;
  for (const w of hole.wells) {
    const black = w.kind === 'black';
    const color = black ? COLORS.blackHole : COLORS.whiteHole;
    const rings = 7;
    for (let k = 0; k < rings; k++) {
      const t = (s / 3 + k / rings) % 1;
      let r: number;
      let alpha: number;
      if (black) {
        r = core + (w.radius - core) * (1 - t) ** 1.6;
        alpha = Math.min(1, t / 0.1) * (0.1 + 0.5 * t) * Math.min(1, (1 - t) / 0.05);
      } else {
        r = core + (w.radius - core) * t ** 0.6;
        alpha = (0.12 + 0.45 * (1 - t)) * Math.min(1, (1 - t) / 0.1) * Math.min(1, t / 0.05);
      }
      const wobble = 0.03 * (r / w.radius);
      fx.lineStyle(black ? 1 + t * 1.5 : 2.5 - t * 1.5, color, alpha);
      fx.strokePoints(wobbly(w.at, r, wobble, s * (black ? -1.5 : 1.5) + k), true, true);
    }

    // Swirling arms round the core, inwards for black, outwards for white.
    const spin = s * (black ? 2.2 : -1.6);
    for (let arm = 0; arm < 3; arm++) {
      const base = spin + (arm * Math.PI * 2) / 3;
      let prev: Vec | null = null;
      for (let r = core + 1; r <= core * 3.4; r += 1.5) {
        const a = base + (r - core) * (black ? 0.18 : -0.18);
        const p = { x: w.at.x + Math.cos(a) * r, y: w.at.y + Math.sin(a) * r };
        if (prev) {
          fx.lineStyle(1.5, color, 0.7 * (1 - (r - core) / (core * 2.4)));
          fx.lineBetween(prev.x, prev.y, p.x, p.y);
        }
        prev = p;
      }
    }

    if (black) {
      fx.fillStyle(COLORS.hole, 1);
      fx.fillCircle(w.at.x, w.at.y, core);
      fx.lineStyle(2, color, 0.75 + 0.25 * Math.sin(s * 5));
      fx.strokeCircle(w.at.x, w.at.y, core);
    } else {
      const beat = 0.5 + 0.5 * Math.sin(s * 4);
      fx.fillStyle(COLORS.whiteHole, 0.15 + 0.15 * beat);
      fx.fillCircle(w.at.x, w.at.y, core + 4);
      fx.fillStyle(COLORS.whiteHole, 0.9);
      fx.fillCircle(w.at.x, w.at.y, core * 0.7);
    }
  }
}

// A circle with a slow wave running round it.
function wobbly(at: Vec, r: number, amount: number, phase: number): Vec[] {
  const out: Vec[] = [];
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    const rr = r * (1 + amount * Math.sin(a * 5 + phase));
    out.push({ x: at.x + Math.cos(a) * rr, y: at.y + Math.sin(a) * rr });
  }
  return out;
}

// Portals as discs of chunky pixels: a bright rim with a gap running round
// it, a two-armed spiral turning inside, a dark eye, and a few pixels in
// orbit. The two ends of a pair turn opposite ways.
function drawPortals(fx: Pen, hole: Moving, look: Layout, time: number) {
  const pr = CONFIG.features.portalRadius;
  const s = time / 1000;
  for (const p of hole.portals) {
    const tint = PORTAL_TINT[p.color];
    for (const [k, end] of [p.a, p.b].entries()) {
      const turn = k ? -1 : 1;
      const x0 = Math.round(end.x);
      const y0 = Math.round(end.y);
      const gap = s * 3 * turn;
      for (const px of look.pixels) {
        let alpha: number;
        if (Math.abs(px.r - pr) <= PIXEL * 0.7) {
          // Two gaps opposite each other, turning.
          const off = Math.abs(Math.sin(px.angle - gap));
          alpha = off < 0.3 ? 0.3 : 0.95;
        } else if (px.r < PIXEL) {
          alpha = 0.04;
        } else {
          const wave = 0.5 + 0.5 * Math.sin(2 * px.angle * turn - px.r * 0.5 + s * 4);
          alpha = [0.08, 0.25, 0.55][Math.min(2, Math.floor(wave * 3))]!;
        }
        fx.fillStyle(tint, alpha);
        fx.fillRect(x0 + px.x, y0 + px.y, PIXEL - 0.6, PIXEL - 0.6);
      }
      for (let n = 0; n < 3; n++) {
        const a = -gap * 0.8 + (n * Math.PI * 2) / 3;
        const r = pr + 5 + 2 * Math.sin(s * 3 + n);
        const qx = Math.round((end.x + Math.cos(a) * r) / PIXEL) * PIXEL;
        const qy = Math.round((end.y + Math.sin(a) * r) / PIXEL) * PIXEL;
        fx.fillStyle(tint, 0.7);
        fx.fillRect(qx - PIXEL / 2, qy - PIXEL / 2, PIXEL - 0.6, PIXEL - 0.6);
      }
    }
  }
}
