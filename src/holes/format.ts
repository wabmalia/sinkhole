import { CONFIG } from '../config';
import { closestOnSegment, dist, type Vec } from '../engine/vec';
import { PORTAL_COLORS, type Hole, type Portal, type PortalColor, type Ramp, type Rect, type Well } from './types';

// Holes are stored as JSON, written by the editor or by hand, and later sent
// in by players. parseHole is the one way in: it reads untrusted data, checks
// every rule and returns a clean Hole, or the reasons it can't.
//
//   {
//     "name": "Straight",
//     "par": 2,
//     "outline": [[0, 0], [360, 0], [360, 900], [0, 900]],
//     "blocks": [[[150, 400], [210, 400], [180, 460]]],
//     "tee": { "x": 120, "y": 790, "w": 120, "h": 70 },
//     "cup": [180, 130],
//     "ramps": [{ "area": [[0, 500], [360, 500], [360, 600], [0, 600]], "angle": 90, "strength": 300 }],
//     "rivers": [[[0, 300], [360, 300], [360, 340], [0, 340]]],
//     "wells": [{ "kind": "black", "at": [180, 450], "radius": 90, "strength": 600 }],
//     "portals": [{ "color": "pink", "a": [60, 700], "b": [300, 200] }]
//   }
//
// Ramps, rivers, wells and portals are optional.

// Every hole fits this frame, so every hole shows at the same size in the game.
export const FRAME = { w: 360, h: 900 } as const;

export const LIMITS = {
  name: 24,
  par: [2, 6],
  outlinePoints: 64,
  blocks: 16,
  blockPoints: 32,
  teeMin: 30,   // the mat is at least this wide and tall
  zones: 12,    // ramps, and rivers, each
  zonePoints: 32,
  rampStrength: [40, 12000], // at the top, 120 units of ramp stop a full-power shot
  wells: 6,
  wellRadius: [30, 220],
  wellStrength: [100, 12000], // same top as ramps, at a well's centre
} as const;

export interface HoleFile {
  name: string;
  par: number;
  outline: [number, number][];
  blocks: [number, number][][];
  tee: Rect;
  cup: [number, number];
  ramps?: { area: [number, number][]; angle: number; strength: number }[];
  rivers?: [number, number][][];
  wells?: { kind: Well['kind']; at: [number, number]; radius: number; strength: number }[];
  portals?: { color: PortalColor; a: [number, number]; b: [number, number] }[];
}

export type Parsed = { hole: Hole; errors: [] } | { hole: null; errors: string[] };

export function parseHole(data: unknown): Parsed {
  const errors: string[] = [];
  const fail = (e: string) => (errors.push(e), null);
  if (!isObject(data)) return { hole: null, errors: ['not a JSON object'] };

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name || name.length > LIMITS.name || /[\p{C}]/u.test(name)) {
    fail(`name: 1 to ${LIMITS.name} plain characters`);
  }
  const par = data.par;
  const [parMin, parMax] = LIMITS.par;
  if (typeof par !== 'number' || !Number.isInteger(par) || par < parMin || par > parMax) {
    fail(`par: a whole number from ${parMin} to ${parMax}`);
  }

  const outline = polygon(data.outline, LIMITS.outlinePoints, 'outline', fail);
  const blocksRaw = Array.isArray(data.blocks) ? data.blocks : data.blocks === undefined ? [] : null;
  if (!blocksRaw) fail('blocks: a list of polygons');
  if (blocksRaw && blocksRaw.length > LIMITS.blocks) fail(`blocks: at most ${LIMITS.blocks}`);
  const blocks = (blocksRaw ?? []).slice(0, LIMITS.blocks).map((b, i) => polygon(b, LIMITS.blockPoints, `block ${i + 1}`, fail));
  const tee = rect(data.tee, fail);
  const cup = point(data.cup) ?? fail('cup: an [x, y] point');

  const ramps = list(data.ramps, LIMITS.zones, 'ramps', fail).map((r, i) => ramp(r, `ramp ${i + 1}`, fail));
  const rivers = list(data.rivers, LIMITS.zones, 'rivers', fail).map((r, i) => polygon(r, LIMITS.zonePoints, `river ${i + 1}`, fail));
  const wells = list(data.wells, LIMITS.wells, 'wells', fail).map((w, i) => well(w, `well ${i + 1}`, fail));
  const portals = list(data.portals, PORTAL_COLORS.length, 'portals', fail).map((p, i) => portal(p, `portal pair ${i + 1}`, fail));

  if (errors.length || !outline || !tee || !cup) return { hole: null, errors };
  const solid = blocks as Vec[][];
  const hole: Hole = {
    name, par: par as number, outline, blocks: solid, tee, cup,
    ramps: ramps as Ramp[], rivers: rivers as Vec[][], wells: wells as Well[], portals: portals as Portal[],
  };

  // Shape rules, now that the pieces are well formed.
  const walls = [outline, ...solid];
  solid.forEach((b, i) => {
    if (!b.every(p => inside(p, outline)) || crosses(b, outline)) fail(`block ${i + 1}: must sit inside the outline`);
    solid.forEach((o, j) => {
      if (j > i && (crosses(b, o) || inside(b[0]!, o) || inside(o[0]!, b))) fail(`blocks ${i + 1} and ${j + 1} overlap`);
    });
  });
  const onFloor = (p: Vec) => inside(p, outline) && !solid.some(b => inside(p, b));
  const clearance = (p: Vec) => Math.min(...walls.flatMap(poly => edges(poly).map(([a, b]) => dist(p, closestOnSegment(p, a, b)))));

  if (!onFloor(cup) || clearance(cup) < CONFIG.cup.radius + CONFIG.ball.radius) {
    fail('cup: must be on the floor, clear of the walls');
  }
  const corners = rectPoints(tee);
  if (tee.w < LIMITS.teeMin || tee.h < LIMITS.teeMin) fail(`tee: at least ${LIMITS.teeMin} wide and tall`);
  if (!corners.every(onFloor) || walls.some(poly => crosses(corners, poly) || poly.some(p => inRect(p, tee)))) {
    fail('tee: must be on the floor, clear of the walls');
  }
  if (inRect(cup, tee)) fail('cup: must not be on the tee');

  // Elements: nothing that moves the ball sits on the tee or the cup.
  const teeZone = corners;
  const zoneClear = (area: Vec[], what: string) => {
    if (inside(cup, area)) fail(`${what}: must not cover the cup`);
    if (crosses(area, teeZone) || area.some(p => inRect(p, tee)) || teeZone.some(p => inside(p, area))) {
      fail(`${what}: must not cover the tee`);
    }
  };
  hole.ramps.forEach((r, i) => zoneClear(r.area, `ramp ${i + 1}`));
  hole.rivers.forEach((r, i) => zoneClear(r, `river ${i + 1}`));
  const nearTee = (p: Vec, r: number) =>
    dist(p, { x: Math.min(Math.max(p.x, tee.x), tee.x + tee.w), y: Math.min(Math.max(p.y, tee.y), tee.y + tee.h) }) < r;
  hole.wells.forEach((w, i) => {
    const what = `${w.kind} hole ${i + 1}`;
    if (!onFloor(w.at)) fail(`${what}: centre must be on the floor`);
    if (nearTee(w.at, w.radius)) fail(`${what}: its reach must not cover the tee`);
    if (w.kind === 'black' && dist(w.at, cup) < CONFIG.features.coreRadius + CONFIG.cup.radius) {
      fail(`${what}: must not swallow the cup`);
    }
  });
  const pr = CONFIG.features.portalRadius;
  const colors = new Set<string>();
  hole.portals.forEach(p => {
    const what = `${p.color} portals`;
    if (colors.has(p.color)) fail(`${what}: one pair per colour`);
    colors.add(p.color);
    for (const end of [p.a, p.b]) {
      if (!onFloor(end) || clearance(end) < pr) fail(`${what}: must be on the floor, clear of the walls`);
      if (dist(end, cup) < pr + CONFIG.cup.radius) fail(`${what}: must not touch the cup`);
      if (nearTee(end, pr)) fail(`${what}: must not touch the tee`);
      if (hole.rivers.some(r => inside(end, r))) fail(`${what}: must not sit in a river`);
    }
    if (dist(p.a, p.b) < pr * 3) fail(`${what}: too close together`);
  });

  if (errors.length) return { hole: null, errors };
  return { hole, errors: [] };
}

// The file the editor saves: one point per line, so diffs stay readable.
export function holeToJson(h: Hole): string {
  const file: HoleFile = {
    name: h.name,
    par: h.par,
    outline: h.outline.map(pair),
    blocks: h.blocks.map(b => b.map(pair)),
    tee: h.tee,
    cup: pair(h.cup),
  };
  // Only the elements a hole uses, so plain holes stay short.
  if (h.ramps.length) file.ramps = h.ramps.map(r => ({ area: r.area.map(pair), angle: r.angle, strength: r.strength }));
  if (h.rivers.length) file.rivers = h.rivers.map(r => r.map(pair));
  if (h.wells.length) file.wells = h.wells.map(w => ({ kind: w.kind, at: pair(w.at), radius: w.radius, strength: w.strength }));
  if (h.portals.length) file.portals = h.portals.map(p => ({ color: p.color, a: pair(p.a), b: pair(p.b) }));
  return (
    JSON.stringify(file, null, 2)
      .replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2]')
      .replace(/"tee": \{\s+([^}]+?)\s+\}/, (_, body: string) => `"tee": { ${body.replace(/\s*\n\s*/g, ' ')} }`) + '\n'
  );
}

// --- Reading --------------------------------------------------------------

type Fail = (e: string) => null;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pair = (p: Vec): [number, number] => [p.x, p.y];

function point(v: unknown): Vec | null {
  if (!Array.isArray(v) || v.length !== 2 || !num(v[0]) || !num(v[1])) return null;
  const p = { x: v[0], y: v[1] };
  return p.x >= 0 && p.x <= FRAME.w && p.y >= 0 && p.y <= FRAME.h ? p : null;
}

function polygon(v: unknown, max: number, what: string, fail: Fail): Vec[] | null {
  if (!Array.isArray(v) || v.length < 3 || v.length > max) return fail(`${what}: 3 to ${max} points`);
  const pts = v.map(point);
  if (pts.some(p => !p)) return fail(`${what}: every point is [x, y] inside the ${FRAME.w} × ${FRAME.h} frame`);
  const poly = pts as Vec[];
  if (!simple(poly)) return fail(`${what}: edges must not cross each other`);
  if (Math.abs(area(poly)) < 100) return fail(`${what}: too small`);
  return poly;
}

// An optional list: missing means none.
function list(v: unknown, max: number, what: string, fail: Fail): unknown[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return (fail(`${what}: a list`), []);
  if (v.length > max) fail(`${what}: at most ${max}`);
  return v.slice(0, max);
}

const between = (v: unknown, [lo, hi]: readonly [number, number]) => num(v) && v >= lo && v <= hi;

function ramp(v: unknown, what: string, fail: Fail): Ramp | null {
  if (!isObject(v)) return fail(`${what}: { area, angle, strength }`);
  const area = polygon(v.area, LIMITS.zonePoints, what, fail);
  if (!num(v.angle)) return fail(`${what}: angle in degrees`);
  if (!between(v.strength, LIMITS.rampStrength)) return fail(`${what}: strength from ${LIMITS.rampStrength.join(' to ')}`);
  return area && { area, angle: ((v.angle % 360) + 360) % 360, strength: v.strength as number };
}

function well(v: unknown, what: string, fail: Fail): Well | null {
  if (!isObject(v) || (v.kind !== 'black' && v.kind !== 'white')) return fail(`${what}: kind "black" or "white"`);
  const at = point(v.at);
  if (!at) return fail(`${what}: at, an [x, y] point`);
  if (!between(v.radius, LIMITS.wellRadius)) return fail(`${what}: radius from ${LIMITS.wellRadius.join(' to ')}`);
  if (!between(v.strength, LIMITS.wellStrength)) return fail(`${what}: strength from ${LIMITS.wellStrength.join(' to ')}`);
  return { kind: v.kind, at, radius: v.radius as number, strength: v.strength as number };
}

function portal(v: unknown, what: string, fail: Fail): Portal | null {
  if (!isObject(v) || !PORTAL_COLORS.includes(v.color as PortalColor)) {
    return fail(`${what}: color, one of ${PORTAL_COLORS.join(', ')}`);
  }
  const a = point(v.a);
  const b = point(v.b);
  if (!a || !b) return fail(`${what}: a and b, [x, y] points`);
  return { color: v.color as PortalColor, a, b };
}

function rect(v: unknown, fail: Fail): Rect | null {
  if (!isObject(v) || ![v.x, v.y, v.w, v.h].every(num)) return fail('tee: { x, y, w, h }');
  const r = { x: v.x as number, y: v.y as number, w: v.w as number, h: v.h as number };
  if (r.w <= 0 || r.h <= 0 || r.x < 0 || r.y < 0 || r.x + r.w > FRAME.w || r.y + r.h > FRAME.h) {
    return fail(`tee: inside the ${FRAME.w} × ${FRAME.h} frame`);
  }
  return r;
}

// --- Geometry -------------------------------------------------------------

const edges = (poly: Vec[]): [Vec, Vec][] => poly.map((a, i) => [a, poly[(i + 1) % poly.length]!]);
const rectPoints = (r: Rect): Vec[] => [
  { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h },
];
const inRect = (p: Vec, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

function area(poly: Vec[]): number {
  return edges(poly).reduce((s, [a, b]) => s + a.x * b.y - b.x * a.y, 0) / 2;
}

// Even-odd ray cast. Points exactly on an edge may land either way.
export function inside(p: Vec, poly: Vec[]): boolean {
  let hit = false;
  for (const [a, b] of edges(poly)) {
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)) hit = !hit;
  }
  return hit;
}

// Do two segments cross at a single point inside both? Touching ends don't count.
function cross(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const o = (p: Vec, q: Vec, r: Vec) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

const crosses = (p: Vec[], q: Vec[]) => edges(p).some(([a, b]) => edges(q).some(([c, d]) => cross(a, b, c, d)));

// Neighbouring edges only share an end, which cross() doesn't count.
function simple(poly: Vec[]): boolean {
  const es = edges(poly);
  return es.every(([a, b], i) => es.every(([c, d], j) => j <= i || !cross(a, b, c, d)));
}
