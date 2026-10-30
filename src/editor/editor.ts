import './editor.css';
import { CONFIG, PORTAL_TINT } from '../config';
import { atRest, step, type Ball, type Course } from '../engine/physics';
import { clamp, closestOnSegment, dist, fromAngle, lerp, type Vec } from '../engine/vec';
import { FRAME, holeToJson, inside, LIMITS, parseHole, type HoleFile } from '../holes/format';
import { courseFrom, PORTAL_COLORS, wallLines, type PortalColor, type Rect, type Well } from '../holes/types';
import { probe, shoot, testBall, type Probe } from './testplay';

// A page for sketching holes, on the dev server only (editor.html isn't part
// of the build). It draws in the hole's own units inside the size limit,
// checks the same rules as the game and saves to src/holes/<id>.json through
// the dev server (see vite.config.ts).

interface DraftRamp {
  area: Vec[];
  angle: number;
  strength: number;
}

interface DraftPortal {
  color: PortalColor;
  a: Vec;
  b: Vec | null;        // null while the second end is being placed
}

interface Draft {
  id: string;
  name: string;
  par: number;
  outline: Vec[];
  blocks: Vec[][];
  tee: Rect | null;
  cup: Vec | null;
  ramps: DraftRamp[];
  rivers: Vec[][];
  wells: Well[];
  portals: DraftPortal[];
}

type Tool = 'move' | 'outline' | 'block' | 'tee' | 'cup' | 'ramp' | 'river' | 'black' | 'white' | 'portal' | 'test';
type Zone = 'blocks' | 'ramps' | 'rivers';
// Something on the hole that can be picked, dragged or deleted.
type Target =
  | { kind: 'vertex'; poly: Vec[]; i: number }
  | { kind: 'cup' }
  | { kind: 'tee' }
  | { kind: 'tee-size' }
  | { kind: 'zone'; zone: Zone; i: number }
  | { kind: 'ramp-dir'; i: number }
  | { kind: 'well'; i: number }
  | { kind: 'well-size'; i: number }
  | { kind: 'portal'; i: number; end: 'a' | 'b' };
// What the properties panel shows.
type Selection = { kind: 'ramp' | 'well' | 'portal'; i: number } | null;

const SNAP = 15;          // half the course grid
const GRID = 30;
const MARGIN = 40;        // room around the frame, in hole units
const HIT = 10;           // how close the pointer must be, in screen pixels
const STATE_KEY = 'sinkhole-editor';
const ARROW = 40;         // length of a ramp's direction arrow, hole units

const HELP: Record<Tool, string> = {
  move: 'Drag corners, the tee (its corner handle resizes it), the cup or any element. Click a ramp, well or portal to edit it below. Double-click a wall to add a corner. Right-click a corner or an element to delete it.',
  outline: 'Click the corners of the outer wall. Click the first corner again, or press Enter, to close it: it replaces the old outline. Esc cancels.',
  block: 'Click the corners of a solid block. Close it on the first corner or with Enter.',
  tee: 'Drag out the tee mat, where players place their first shot.',
  cup: 'Click where the cup goes.',
  ramp: 'Click the corners of a ramp, then close it. Drag its arrow to point downhill; set how steep it is below.',
  river: 'Click the corners of a river, then close it. It slows the ball hard: a strong shot can get across a narrow one, but a ball that stops in it goes back where the shot started, +1 stroke.',
  black: 'Click to place a black hole. It pulls balls in and swallows them at the core, like a river. Drag its ring to change its reach.',
  white: 'Click to place a white hole. It pushes balls away. Drag its ring to change its reach.',
  portal: 'Click twice: where the ball goes in, and where it comes out. Each colour is one pair.',
  test: 'Drag anywhere to pull back and aim, let go to shoot. No meter: every shot goes exactly as aimed. Drag the ball to try a shot from anywhere. Esc puts it back on the tee.',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  stage: $('stage'),
  canvas: $<HTMLCanvasElement>('canvas'),
  load: $<HTMLSelectElement>('load'),
  fresh: $<HTMLButtonElement>('new'),
  id: $<HTMLInputElement>('id'),
  name: $<HTMLInputElement>('name'),
  par: $<HTMLInputElement>('par'),
  tools: $('tools'),
  help: $('help'),
  props: $('props'),
  rules: $('rules'),
  save: $<HTMLButtonElement>('save'),
  play: $<HTMLButtonElement>('play'),
  copy: $<HTMLButtonElement>('copy'),
  status: $('status'),
};
const ctx = el.canvas.getContext('2d')!;

const blank = (): Draft => ({
  id: 'new-hole',
  name: 'New hole',
  par: 3,
  outline: [{ x: 0, y: 0 }, { x: FRAME.w, y: 0 }, { x: FRAME.w, y: FRAME.h }, { x: 0, y: FRAME.h }],
  blocks: [],
  tee: { x: 120, y: 790, w: 120, h: 70 },
  cup: { x: 180, y: 130 },
  ramps: [],
  rivers: [],
  wells: [],
  portals: [],
});

const kept = restore();
let draft: Draft = kept ? { ...blank(), ...kept.draft } : blank();
let tool: Tool = 'move';
let drawing: Vec[] = [];           // corners of a shape being placed
let pointer: Vec | null = null;    // under the mouse, in hole units, snapped
let hover: Target | null = null;
let selected: Selection = null;
let free = false;                  // Shift: no snapping
let drag: { target: Target; from: Vec; tee: Rect | null; zone: Vec[]; } | null = null;
let teeFrom: Vec | null = null;
let savedText = kept?.savedText ?? ''; // the file as last saved or opened
const history: string[] = [];
const view = { scale: 1, ox: 0, oy: 0 };

// The test tool: a ball rolling on the sketch with the game's physics.
const test = {
  course: null as Course | null,
  ball: null as Ball | null,
  strokes: 0,
  rolling: false,
  trail: [] as Vec[],
  aimFrom: null as Vec | null,      // where the pull-back started, screen px
  aim: null as { angle: number; power: number } | null,
  movingBall: false,
  note: '',
  probe: null as Probe | null,
  probing: false,
  stopProbe: () => {},
};

// --- Draft <-> file ---------------------------------------------------------

const pair = (p: Vec): [number, number] => [p.x, p.y];

function toFile(d: Draft): Partial<HoleFile> {
  const portals = d.portals.filter(p => p.b);
  return {
    name: d.name,
    par: d.par,
    outline: d.outline.map(pair),
    blocks: d.blocks.map(b => b.map(pair)),
    ...(d.tee ? { tee: d.tee } : {}),
    ...(d.cup ? { cup: pair(d.cup) } : {}),
    ...(d.ramps.length ? { ramps: d.ramps.map(r => ({ area: r.area.map(pair), angle: r.angle, strength: r.strength })) } : {}),
    ...(d.rivers.length ? { rivers: d.rivers.map(r => r.map(pair)) } : {}),
    ...(d.wells.length ? { wells: d.wells.map(w => ({ kind: w.kind, at: pair(w.at), radius: w.radius, strength: w.strength })) } : {}),
    ...(portals.length ? { portals: portals.map(p => ({ color: p.color, a: pair(p.a), b: pair(p.b!) })) } : {}),
  };
}

// Lenient, so a file that breaks the rules can still be opened and fixed.
function fromFile(id: string, data: unknown): Draft {
  const f = (typeof data === 'object' && data ? data : {}) as Record<string, unknown>;
  const vec = (v: unknown): Vec | null =>
    Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number' ? { x: v[0], y: v[1] } : null;
  const poly = (v: unknown): Vec[] => (Array.isArray(v) ? v.map(vec).filter((p): p is Vec => !!p) : []);
  const objs = (v: unknown) => (Array.isArray(v) ? v.filter(o => typeof o === 'object' && o) : []) as Record<string, unknown>[];
  const n = (v: unknown, or: number) => (typeof v === 'number' ? v : or);
  const t = f.tee as Rect | undefined;
  return {
    id,
    name: typeof f.name === 'string' ? f.name : id,
    par: n(f.par, 3),
    outline: poly(f.outline),
    blocks: Array.isArray(f.blocks) ? f.blocks.map(poly) : [],
    tee: t && [t.x, t.y, t.w, t.h].every(v => typeof v === 'number') ? { x: t.x, y: t.y, w: t.w, h: t.h } : null,
    cup: vec(f.cup),
    ramps: objs(f.ramps).map(r => ({ area: poly(r.area), angle: n(r.angle, 90), strength: n(r.strength, 300) })),
    rivers: Array.isArray(f.rivers) ? f.rivers.map(poly) : [],
    wells: objs(f.wells).flatMap(w => {
      const at = vec(w.at);
      return at ? [{ kind: w.kind === 'white' ? 'white' : 'black', at, radius: n(w.radius, 80), strength: n(w.strength, 600) } as Well] : [];
    }),
    portals: objs(f.portals).flatMap(p => {
      const a = vec(p.a);
      const color = PORTAL_COLORS.find(c => c === p.color);
      return a && color ? [{ color, a, b: vec(p.b) }] : [];
    }),
  };
}

const fileText = () => JSON.stringify(toFile(draft));

// --- Changes and undo -------------------------------------------------------

function remember() {
  history.push(JSON.stringify(draft));
  if (history.length > 200) history.shift();
}

function undo() {
  const last = history.pop();
  if (!last) return;
  draft = JSON.parse(last) as Draft;
  drawing = [];
  selected = null;
  changed();
}

function changed() {
  keep();
  renderPanel();
  draw();
}

// The draft, what was last saved and the status line survive a reload (Vite
// reloads the page whenever a hole is saved) and a closed tab.
interface Kept {
  draft: Draft;
  savedText: string;
  status: string;
}

function keep() {
  try {
    const kept: Kept = { draft, savedText, status: el.status.textContent ?? '' };
    localStorage.setItem(STATE_KEY, JSON.stringify(kept));
  } catch {
    // Private mode or storage off: the draft just isn't kept.
  }
}

function restore(): Kept | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as Kept) : null;
  } catch {
    return null;
  }
}

// --- Coordinates ------------------------------------------------------------

const toWorld = (sx: number, sy: number): Vec => ({ x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale });
const toScreen = (p: Vec): Vec => ({ x: p.x * view.scale + view.ox, y: p.y * view.scale + view.oy });

function place(p: Vec): Vec {
  const step = free ? 1 : SNAP;
  return {
    x: Math.min(FRAME.w, Math.max(0, Math.round(p.x / step) * step)),
    y: Math.min(FRAME.h, Math.max(0, Math.round(p.y / step) * step)),
  };
}

const near = (a: Vec, b: Vec) => dist(toScreen(a), toScreen(b)) <= HIT;

function centroid(poly: Vec[]): Vec {
  const n = poly.length || 1;
  return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
}

const arrowTip = (r: DraftRamp): Vec => {
  const c = centroid(r.area);
  const d = fromAngle((r.angle * Math.PI) / 180, ARROW);
  return { x: c.x + d.x, y: c.y + d.y };
};
const ringHandle = (w: Well): Vec => ({ x: w.at.x + w.radius, y: w.at.y });

const zoneOf = (zone: Zone, i: number): Vec[] | undefined =>
  zone === 'ramps' ? draft.ramps[i]?.area : zone === 'rivers' ? draft.rivers[i] : draft.blocks[i];

function hitAt(w: Vec): Target | null {
  for (const poly of [draft.outline, ...draft.blocks, ...draft.ramps.map(r => r.area), ...draft.rivers]) {
    const i = poly.findIndex(p => near(p, w));
    if (i >= 0) return { kind: 'vertex', poly, i };
  }
  for (const [i, p] of draft.portals.entries()) {
    if (dist(p.a, w) <= CONFIG.features.portalRadius) return { kind: 'portal', i, end: 'a' };
    if (p.b && dist(p.b, w) <= CONFIG.features.portalRadius) return { kind: 'portal', i, end: 'b' };
  }
  for (const [i, well] of draft.wells.entries()) {
    if (dist(well.at, w) <= CONFIG.features.coreRadius + HIT / view.scale) return { kind: 'well', i };
    if (near(ringHandle(well), w)) return { kind: 'well-size', i };
  }
  for (const [i, r] of draft.ramps.entries()) if (near(arrowTip(r), w)) return { kind: 'ramp-dir', i };
  if (draft.cup && dist(draft.cup, w) <= CONFIG.cup.radius + HIT / view.scale) return { kind: 'cup' };
  const t = draft.tee;
  if (t && near({ x: t.x + t.w, y: t.y + t.h }, w)) return { kind: 'tee-size' };
  if (t && w.x >= t.x && w.x <= t.x + t.w && w.y >= t.y && w.y <= t.y + t.h) return { kind: 'tee' };
  for (const zone of ['blocks', 'ramps', 'rivers'] as const) {
    const list = zone === 'ramps' ? draft.ramps.map(r => r.area) : draft[zone];
    const i = list.findIndex(poly => inside(w, poly));
    if (i >= 0) return { kind: 'zone', zone, i };
  }
  return null;
}

// Which element a target belongs to, for the properties panel.
function selectionOf(t: Target): Selection {
  if (t.kind === 'ramp-dir' || (t.kind === 'zone' && t.zone === 'ramps')) return { kind: 'ramp', i: t.i };
  if (t.kind === 'well' || t.kind === 'well-size') return { kind: 'well', i: t.i };
  if (t.kind === 'portal') return { kind: 'portal', i: t.i };
  if (t.kind === 'vertex') {
    const r = draft.ramps.findIndex(ramp => ramp.area === t.poly);
    if (r >= 0) return { kind: 'ramp', i: r };
  }
  return null;
}

// --- Pointer ----------------------------------------------------------------

el.canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  // Leave the text fields, so the tool keys work again.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  el.canvas.setPointerCapture(e.pointerId);
  free = e.shiftKey;
  const raw = toWorld(e.offsetX, e.offsetY);
  const p = place(raw);
  if (tool === 'test') return testDown(e.offsetX, e.offsetY, raw);
  if (tool === 'move') {
    const target = hitAt(raw);
    selected = target ? selectionOf(target) : null;
    renderPanel();
    if (!target) return draw();
    remember();
    const zone = target.kind === 'zone' ? zoneOf(target.zone, target.i) ?? [] : [];
    drag = { target, from: p, tee: draft.tee && { ...draft.tee }, zone: zone.map(v => ({ ...v })) };
  } else if (tool === 'outline' || tool === 'block' || tool === 'ramp' || tool === 'river') {
    if (drawing.length >= 3 && near(drawing[0]!, raw)) return closeShape();
    if (!drawing.some(q => q.x === p.x && q.y === p.y)) drawing.push(p);
  } else if (tool === 'tee') {
    remember();
    teeFrom = p;
  } else if (tool === 'cup') {
    remember();
    draft.cup = p;
    changed();
  } else if (tool === 'black' || tool === 'white') {
    remember();
    draft.wells.push({ kind: tool, at: p, radius: 80, strength: 600 });
    selected = { kind: 'well', i: draft.wells.length - 1 };
    changed();
  } else if (tool === 'portal') {
    placePortal(p);
  }
  draw();
});

// The first click of a pair takes the next free colour; the second closes it.
function placePortal(p: Vec) {
  const open = draft.portals.findIndex(q => !q.b);
  remember();
  if (open >= 0) {
    draft.portals[open]!.b = p;
    selected = { kind: 'portal', i: open };
  } else {
    const color = PORTAL_COLORS.find(c => !draft.portals.some(q => q.color === c));
    if (!color) {
      history.pop();
      return status(`All ${PORTAL_COLORS.length} portal colours are in use.`);
    }
    draft.portals.push({ color, a: p, b: null });
  }
  changed();
}

el.canvas.addEventListener('pointermove', e => {
  free = e.shiftKey;
  const raw = toWorld(e.offsetX, e.offsetY);
  const p = place(raw);
  pointer = p;
  if (tool === 'test') return testMove(e.offsetX, e.offsetY, raw);
  if (drag) {
    moveTarget(drag.target, p, raw);
    changed();
    return;
  }
  if (teeFrom) {
    draft.tee = {
      x: Math.min(teeFrom.x, p.x),
      y: Math.min(teeFrom.y, p.y),
      w: Math.abs(p.x - teeFrom.x),
      h: Math.abs(p.y - teeFrom.y),
    };
    changed();
    return;
  }
  hover = tool === 'move' ? hitAt(raw) : null;
  el.canvas.style.cursor = tool === 'move' ? (hover ? 'grab' : 'default') : 'crosshair';
  draw();
});

function moveTarget(t: Target, p: Vec, raw: Vec) {
  if (!drag) return;
  const d = { x: p.x - drag.from.x, y: p.y - drag.from.y };
  switch (t.kind) {
    case 'vertex':
      t.poly[t.i] = p;
      break;
    case 'cup':
      draft.cup = p;
      break;
    case 'tee':
      if (drag.tee) draft.tee = { ...drag.tee, x: drag.tee.x + d.x, y: drag.tee.y + d.y };
      break;
    case 'tee-size':
      if (drag.tee) draft.tee = { ...drag.tee, w: Math.max(SNAP, drag.tee.w + d.x), h: Math.max(SNAP, drag.tee.h + d.y) };
      break;
    case 'zone': {
      const moved = drag.zone.map(v => ({ x: v.x + d.x, y: v.y + d.y }));
      if (t.zone === 'ramps') draft.ramps[t.i]!.area = moved;
      else draft[t.zone][t.i] = moved;
      break;
    }
    case 'ramp-dir': {
      // Points where the pointer is, in steps of 15°.
      const r = draft.ramps[t.i]!;
      const c = centroid(r.area);
      const deg = (Math.atan2(raw.y - c.y, raw.x - c.x) * 180) / Math.PI;
      r.angle = (((free ? Math.round(deg) : Math.round(deg / 15) * 15) % 360) + 360) % 360;
      break;
    }
    case 'well':
      draft.wells[t.i]!.at = p;
      break;
    case 'well-size': {
      const [lo, hi] = LIMITS.wellRadius;
      const w = draft.wells[t.i]!;
      w.radius = Math.min(hi, Math.max(lo, Math.round(dist(w.at, raw) / 5) * 5));
      break;
    }
    case 'portal':
      draft.portals[t.i]![t.end] = p;
      break;
  }
}

el.canvas.addEventListener('pointerup', () => {
  if (tool === 'test') return testUp();
  if (teeFrom && draft.tee && (draft.tee.w === 0 || draft.tee.h === 0)) undo();
  drag = null;
  teeFrom = null;
});

el.canvas.addEventListener('pointerleave', () => {
  pointer = null;
  draw();
});

// Double-click a wall or an edge to add a corner there.
el.canvas.addEventListener('dblclick', e => {
  if (tool !== 'move') return;
  const w = toWorld(e.offsetX, e.offsetY);
  for (const poly of [draft.outline, ...draft.blocks, ...draft.ramps.map(r => r.area), ...draft.rivers]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      if (near(closestOnSegment(w, a, b), w)) {
        remember();
        poly.splice(i + 1, 0, place(w));
        return changed();
      }
    }
  }
});

el.canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (tool !== 'test') remove(hitAt(toWorld(e.offsetX, e.offsetY)));
});

// A corner (while its shape keeps three) or a whole element.
function remove(t: Target | null) {
  if (!t) return;
  remember();
  if (t.kind === 'vertex' && t.poly.length > 3) t.poly.splice(t.i, 1);
  else if (t.kind === 'zone') (t.zone === 'ramps' ? draft.ramps : draft[t.zone]).splice(t.i, 1);
  else if (t.kind === 'ramp-dir') draft.ramps.splice(t.i, 1);
  else if (t.kind === 'well' || t.kind === 'well-size') draft.wells.splice(t.i, 1);
  else if (t.kind === 'portal') draft.portals.splice(t.i, 1);
  else return void history.pop();
  hover = null;
  selected = null;
  changed();
}

function closeShape() {
  if (drawing.length < 3) return;
  remember();
  if (tool === 'outline') draft.outline = drawing;
  else if (tool === 'block') draft.blocks.push(drawing);
  else if (tool === 'river') draft.rivers.push(drawing);
  else if (tool === 'ramp') {
    draft.ramps.push({ area: drawing, angle: 90, strength: 300 });
    selected = { kind: 'ramp', i: draft.ramps.length - 1 };
  }
  drawing = [];
  changed();
}

// --- Keys -------------------------------------------------------------------

const KEYS: Record<string, Tool> = {
  v: 'move', o: 'outline', b: 'block', t: 'tee', c: 'cup', r: 'ramp', w: 'river', h: 'black', j: 'white', p: 'portal', s: 'test',
};

window.addEventListener('keydown', e => {
  free = e.shiftKey;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
    // Esc leaves the field, so the tool keys work again.
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  } else if (e.key === 'Enter') {
    closeShape();
  } else if (e.key === 'Escape' && tool === 'test') {
    testReset();
  } else if (e.key === 'Escape') {
    drawing = [];
    // A portal waiting for its second end goes too.
    if (draft.portals.some(p => !p.b)) draft.portals = draft.portals.filter(p => p.b);
    changed();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && tool !== 'test') {
    remove(hover ?? selectedTarget());
  } else if (!e.metaKey && !e.ctrlKey && KEYS[e.key.toLowerCase()]) {
    setTool(KEYS[e.key.toLowerCase()]!);
  }
});
window.addEventListener('keyup', e => (free = e.shiftKey));

function selectedTarget(): Target | null {
  if (!selected) return null;
  if (selected.kind === 'ramp') return { kind: 'zone', zone: 'ramps', i: selected.i };
  if (selected.kind === 'well') return { kind: 'well', i: selected.i };
  return { kind: 'portal', i: selected.i, end: 'a' };
}

function setTool(t: Tool) {
  test.stopProbe();
  test.probing = false;
  if (t === 'test') {
    // Test what's drawn now; it has to follow the rules to be playable.
    const { hole } = parseHole(toFile(draft));
    if (!hole) {
      status('Fix the rules first, then test.');
      return;
    }
    test.course = courseFrom(hole);
    selected = null;
    testReset();
    status('');
  }
  tool = t;
  drawing = [];
  hover = null;
  el.canvas.style.cursor = t === 'move' || t === 'test' ? 'default' : 'crosshair';
  renderPanel();
  draw();
}

// --- Test play --------------------------------------------------------------

function testReset() {
  const t = draft.tee;
  test.ball = testBall(t ? { x: t.x + t.w / 2, y: t.y + t.h / 2 } : { x: FRAME.w / 2, y: FRAME.h / 2 });
  test.strokes = 0;
  test.rolling = false;
  test.trail = [];
  test.aim = null;
  test.note = '';
  clearProbe();
  renderPanel();
  draw();
}

function clearProbe() {
  test.stopProbe();
  test.probe = null;
  test.probing = false;
}

function testDown(sx: number, sy: number, raw: Vec) {
  const b = test.ball;
  if (!b || test.rolling) return;
  const R = CONFIG.ball.radius;
  if (dist(toScreen(b.pos), { x: sx, y: sy }) <= HIT + R * view.scale) {
    test.movingBall = true;
    b.pos = clampFrame(raw);
    clearProbe();
  } else {
    test.aimFrom = { x: sx, y: sy };
  }
  draw();
}

const clampFrame = (p: Vec): Vec => ({ x: clamp(p.x, 0, FRAME.w), y: clamp(p.y, 0, FRAME.h) });

function testMove(sx: number, sy: number, raw: Vec) {
  const b = test.ball;
  if (b && test.movingBall) {
    b.pos = clampFrame(raw);
  } else if (test.aimFrom) {
    // Pull back like a slingshot, as in the game.
    const dx = test.aimFrom.x - sx;
    const dy = test.aimFrom.y - sy;
    test.aim = Math.hypot(dx, dy) < 8 ? null : {
      angle: Math.atan2(dy, dx),
      power: clamp(Math.hypot(dx, dy) / CONFIG.aim.dragFull, CONFIG.aim.minPower, 1),
    };
  }
  draw();
}

function testUp() {
  test.movingBall = false;
  test.aimFrom = null;
  const aim = test.aim;
  if (!test.ball || !aim || !test.course) return draw();
  // After a sunk ball, the next shot starts over from the tee.
  if (test.ball.sunk) testReset();
  shoot(test.ball!, aim.angle, aim.power);
  test.aim = null;
  test.strokes++;
  test.note = '';
  test.trail = [{ ...test.ball!.pos }];
  test.rolling = true;
  clearProbe();
  renderPanel();
  let last = performance.now();
  let acc = 0;
  const frame = (now: number) => {
    const ball = test.ball;
    if (!test.rolling || !ball || !test.course || tool !== 'test') return;
    acc += Math.min(now - last, 100) / 1000;
    last = now;
    while (acc >= CONFIG.physics.step) {
      acc -= CONFIG.physics.step;
      for (const e of step(test.course, [ball])) {
        if (e.type === 'reset') {
          test.strokes++;
          test.note = e.cause === 'river' ? 'In the river: back, +1.' : 'Swallowed: back, +1.';
          test.trail = [];
        } else if (e.type === 'portal') {
          test.trail = [];
        }
      }
    }
    const tail = test.trail[test.trail.length - 1];
    if (!tail || dist(tail, ball.pos) > 3) test.trail.push({ ...ball.pos });
    if (atRest([ball])) {
      test.rolling = false;
      if (ball.sunk) test.note = `Sunk in ${test.strokes} (par ${draft.par}).`;
      renderPanel();
    }
    draw();
    if (test.rolling) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function startProbe() {
  const b = test.ball;
  if (!b || !test.course || test.rolling) return;
  clearProbe();
  test.probing = true;
  test.stopProbe = probe(test.course, b.pos, (p, done) => {
    test.probe = p;
    test.probing = !done;
    renderPanel();
    draw();
  });
}

// --- Panel ------------------------------------------------------------------

el.tools.addEventListener('click', e => {
  const t = (e.target as HTMLElement).closest('button')?.dataset.tool as Tool | undefined;
  if (t) setTool(t);
});

el.id.addEventListener('input', () => {
  draft.id = el.id.value.trim().toLowerCase();
  changed();
});
el.name.addEventListener('input', () => {
  draft.name = el.name.value;
  changed();
});
el.par.addEventListener('input', () => {
  draft.par = Number(el.par.value);
  changed();
});

// The selected element's settings. Built when the selection changes; the
// inputs then edit the draft directly.
let propsFor = '';
function renderProps() {
  if (tool === 'test') return renderTestProps();
  const key = selected ? `${selected.kind}:${selected.i}` : '';
  const ramp = selected?.kind === 'ramp' ? draft.ramps[selected.i] : undefined;
  const well = selected?.kind === 'well' ? draft.wells[selected.i] : undefined;
  const portal = selected?.kind === 'portal' ? draft.portals[selected.i] : undefined;
  if (!ramp && !well && !portal) {
    el.props.hidden = true;
    propsFor = '';
    return;
  }
  el.props.hidden = false;
  if (key === propsFor) {
    // Same element: just follow drags on the canvas.
    for (const input of el.props.querySelectorAll<HTMLInputElement>('input[data-prop]')) {
      if (document.activeElement === input) continue;
      const v = (ramp ?? well) as unknown as Record<string, number> | undefined;
      if (v) input.value = String(v[input.dataset.prop!]);
      const out = input.nextElementSibling;
      if (out) out.textContent = input.value;
    }
    return;
  }
  propsFor = key;
  const rows: HTMLElement[] = [];
  const title = document.createElement('p');
  title.className = 'props-title';
  rows.push(title);
  if (ramp) {
    title.textContent = 'RAMP';
    rows.push(slider('STEEP', 'strength', ramp.strength, LIMITS.rampStrength, 40, v => (ramp.strength = v)));
    rows.push(slider('DOWNHILL°', 'angle', ramp.angle, [0, 345], 15, v => (ramp.angle = v)));
  } else if (well) {
    title.textContent = well.kind === 'black' ? 'BLACK HOLE' : 'WHITE HOLE';
    rows.push(slider('REACH', 'radius', well.radius, LIMITS.wellRadius, 5, v => (well.radius = v)));
    rows.push(slider('STRENGTH', 'strength', well.strength, LIMITS.wellStrength, 40, v => (well.strength = v)));
    const flip = document.createElement('button');
    flip.type = 'button';
    flip.textContent = well.kind === 'black' ? 'MAKE IT WHITE' : 'MAKE IT BLACK';
    flip.addEventListener('click', () => {
      remember();
      well.kind = well.kind === 'black' ? 'white' : 'black';
      propsFor = '';
      changed();
    });
    rows.push(flip);
  } else if (portal) {
    title.textContent = 'PORTALS';
    const pick = document.createElement('select');
    for (const c of PORTAL_COLORS) {
      const taken = c !== portal.color && draft.portals.some(q => q.color === c);
      pick.append(Object.assign(new Option(c.toUpperCase(), c), { disabled: taken }));
    }
    pick.value = portal.color;
    pick.addEventListener('change', () => {
      remember();
      portal.color = pick.value as PortalColor;
      changed();
    });
    rows.push(pick);
  }
  el.props.replaceChildren(...rows);
}

function renderTestProps() {
  el.props.hidden = false;
  if (propsFor !== 'test') {
    propsFor = 'test';
    const title = Object.assign(document.createElement('p'), { className: 'props-title', textContent: 'TEST PLAY' });
    const info = Object.assign(document.createElement('p'), { className: 'props-info' });
    const row = Object.assign(document.createElement('div'), { className: 'field-row' });
    const back = Object.assign(document.createElement('button'), { type: 'button', textContent: 'BACK TO TEE' });
    back.addEventListener('click', testReset);
    const go = Object.assign(document.createElement('button'), { type: 'button', textContent: 'PROBE' });
    go.addEventListener('click', startProbe);
    row.append(back, go);
    const result = Object.assign(document.createElement('p'), { className: 'props-info' });
    el.props.replaceChildren(title, info, row, result);
  }
  const [, info, row, result] = el.props.children as unknown as HTMLElement[];
  info!.textContent = `Strokes: ${test.strokes}${test.note ? `. ${test.note}` : ''}`;
  (row!.lastElementChild as HTMLButtonElement).disabled = test.rolling || test.probing;
  const p = test.probe;
  result!.textContent = !p
    ? 'PROBE tries every direction at 12 powers from where the ball is, and shows which can sink.'
    : `${test.probing ? 'Probing… ' : ''}${p.sunk} of ${p.tried} shots sink (${((p.sunk / Math.max(1, p.tried)) * 100).toFixed(1)}%)` +
      (test.probing ? '' : p.sunk ? '. Gold rays are directions that can.' : '. None can from here.');
}

function slider(label: string, prop: string, value: number, [lo, hi]: readonly [number, number], step: number, set: (v: number) => void) {
  const row = document.createElement('label');
  row.className = 'slider';
  row.append(label);
  const input = Object.assign(document.createElement('input'), { type: 'range', min: String(lo), max: String(hi), step: String(step) });
  input.value = String(value);
  input.dataset.prop = prop;
  const out = document.createElement('output');
  out.textContent = String(value);
  input.addEventListener('pointerdown', remember);
  input.addEventListener('input', () => {
    set(Number(input.value));
    out.textContent = input.value;
    changed();
  });
  row.append(input, out);
  return row;
}

el.fresh.addEventListener('click', () => {
  remember();
  draft = blank();
  selected = null;
  savedText = '';
  changed();
});

el.load.addEventListener('change', async () => {
  const id = el.load.value;
  el.load.value = '';
  if (!id) return;
  const res = await fetch(`/__holes/${id}`);
  if (!res.ok) return status(`Couldn't open ${id}.`);
  remember();
  draft = fromFile(id, await res.json());
  drawing = [];
  selected = null;
  savedText = fileText();
  changed();
  status(`Opened src/holes/${id}.json`);
});

el.save.addEventListener('click', async () => {
  const res = await fetch(`/__holes/${draft.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toFile(draft)),
  });
  const body = (await res.json()) as { saved?: string; errors?: string[] };
  if (!res.ok) return status(`Not saved: ${(body.errors ?? [String(res.status)]).join('; ')}`);
  savedText = fileText();
  renderPanel();
  status(`Saved to ${body.saved}. Tests and the game pick it up from there.`);
});

el.play.addEventListener('click', () => window.open(`/?hole=${encodeURIComponent(draft.id)}`, '_blank'));

el.copy.addEventListener('click', async () => {
  const { hole } = parseHole(toFile(draft));
  await navigator.clipboard.writeText(hole ? holeToJson(hole) : JSON.stringify(toFile(draft), null, 2));
  status('Copied.');
});

function status(text: string) {
  el.status.textContent = text;
  keep();
}

async function listHoles() {
  const ids = (await (await fetch('/__holes/')).json()) as string[];
  const first = new Option('Open a hole…', '');
  el.load.replaceChildren(first, ...ids.map(id => new Option(id, id)));
}

function renderPanel() {
  if (document.activeElement !== el.id) el.id.value = draft.id;
  if (document.activeElement !== el.name) el.name.value = draft.name;
  if (document.activeElement !== el.par) el.par.value = String(draft.par);
  for (const b of el.tools.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.tool === tool);
  el.help.textContent = HELP[tool];
  renderProps();

  const { errors } = parseHole(toFile(draft));
  const idOk = /^[a-z0-9][a-z0-9-]{0,31}$/.test(draft.id);
  const half = draft.portals.some(p => !p.b) ? ['portals: place the second end'] : [];
  const problems = [...(idOk ? [] : ['file: lowercase letters, digits and dashes']), ...half, ...errors];
  el.rules.replaceChildren(
    ...(problems.length
      ? problems.map(p => Object.assign(document.createElement('li'), { textContent: p }))
      : [Object.assign(document.createElement('li'), { textContent: '✓ Follows the rules', className: 'ok' })]),
  );
  el.save.disabled = problems.length > 0;
  // Play opens the saved file, so only once what's on screen is saved.
  el.play.disabled = problems.length > 0 || fileText() !== savedText;
}

// --- Drawing ----------------------------------------------------------------

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const C = {
  bg: '#12152a',
  floor: '#1d2140',
  grid: '#272c52',
  gridBright: '#353b66',
  wall: '#5ce1ff',
  wallCore: '#d8f8ff',
  mat: '#3b6cf6',
  cup: '#f2b134',
  hole: '#05060f',
  muted: '#c0c4dc',
  ramp: '#7fb2ff',
  river: '#3df2c0',
  black: '#a07cff',
  white: '#eef0fa',
};

function path(poly: Vec[], close = true) {
  ctx.beginPath();
  poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (close) ctx.closePath();
}

const isSelected = (kind: NonNullable<Selection>['kind'], i: number) => selected?.kind === kind && selected.i === i;

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const w = el.stage.clientWidth;
  const h = el.stage.clientHeight;
  if (el.canvas.width !== Math.round(w * dpr) || el.canvas.height !== Math.round(h * dpr)) {
    el.canvas.width = Math.round(w * dpr);
    el.canvas.height = Math.round(h * dpr);
  }
  view.scale = Math.min(w / (FRAME.w + MARGIN * 2), h / (FRAME.h + MARGIN * 2));
  view.ox = (w - FRAME.w * view.scale) / 2;
  view.oy = (h - FRAME.h * view.scale) / 2;
  const px = 1 / view.scale; // one screen pixel, in hole units

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, el.canvas.width, el.canvas.height);
  ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.ox, dpr * view.oy);

  // Floor and blocks.
  if (draft.outline.length >= 3) {
    ctx.fillStyle = C.floor;
    path(draft.outline);
    ctx.fill();
  }
  ctx.fillStyle = C.bg;
  for (const b of draft.blocks) {
    path(b);
    ctx.fill();
  }

  // Grid over the frame: the snap steps faint, the course grid brighter.
  for (let x = 0; x <= FRAME.w; x += SNAP) line({ x, y: 0 }, { x, y: FRAME.h }, x % GRID ? C.grid : C.gridBright, px);
  for (let y = 0; y <= FRAME.h; y += SNAP) line({ x: 0, y }, { x: FRAME.w, y }, y % GRID ? C.grid : C.gridBright, px);

  // The size limit.
  ctx.setLineDash([6 * px, 6 * px]);
  ctx.strokeStyle = C.muted;
  ctx.lineWidth = px;
  ctx.strokeRect(0, 0, FRAME.w, FRAME.h);
  ctx.setLineDash([]);

  // Rivers and ramps.
  for (const r of draft.rivers) {
    ctx.fillStyle = 'rgb(61 242 192 / 0.22)';
    path(r);
    ctx.fill();
    ctx.strokeStyle = C.river;
    ctx.lineWidth = 1.5 * px;
    ctx.stroke();
  }
  draft.ramps.forEach((r, i) => {
    ctx.fillStyle = `rgb(127 178 255 / ${0.06 + Math.min(r.strength, 12000) / 40000})`;
    path(r.area);
    ctx.fill();
    ctx.strokeStyle = isSelected('ramp', i) ? C.cup : C.ramp;
    ctx.lineWidth = 1.5 * px;
    ctx.stroke();
    // The downhill arrow, with its tip as a handle.
    const c = centroid(r.area);
    const tip = arrowTip(r);
    const a = (r.angle * Math.PI) / 180;
    ctx.strokeStyle = C.ramp;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(tip.x, tip.y);
    for (const side of [0.8, -0.8]) {
      const wing = fromAngle(a + Math.PI * side, 10);
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x + wing.x, tip.y + wing.y);
    }
    ctx.stroke();
  });

  // Tee.
  const t = draft.tee;
  if (t) {
    ctx.fillStyle = 'rgb(59 108 246 / 0.18)';
    ctx.fillRect(t.x, t.y, t.w, t.h);
    ctx.strokeStyle = C.mat;
    ctx.lineWidth = 1.5 * px;
    ctx.strokeRect(t.x, t.y, t.w, t.h);
  }

  // Cup.
  if (draft.cup) circle(draft.cup, CONFIG.cup.radius, C.hole, C.cup, 2 * px);

  // Wells: their reach, and the core.
  draft.wells.forEach((w, i) => {
    const color = w.kind === 'black' ? C.black : C.white;
    ctx.setLineDash([4 * px, 4 * px]);
    ctx.strokeStyle = isSelected('well', i) ? C.cup : color;
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.arc(w.at.x, w.at.y, w.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    circle(w.at, CONFIG.features.coreRadius, w.kind === 'black' ? C.hole : 'rgb(238 240 250 / 0.5)', color, 2 * px);
  });

  // Portals, the pair joined by a faint line.
  draft.portals.forEach((p, i) => {
    const tint = hex(PORTAL_TINT[p.color]);
    if (p.b) {
      ctx.setLineDash([3 * px, 6 * px]);
      line(p.a, p.b, tint, px);
      ctx.setLineDash([]);
    }
    for (const end of [p.a, p.b]) {
      if (!end) continue;
      circle(end, CONFIG.features.portalRadius, `${tint}33`, isSelected('portal', i) ? C.cup : tint, 2.5 * px);
    }
  });

  // Whole block outlines, faintly under the walls: the parts outside the course so they can still be grabbed.
  ctx.strokeStyle = C.gridBright;
  ctx.lineWidth = px;
  for (const b of draft.blocks) {
    path(b);
    ctx.stroke();
  }

  // Neon walls.
  ctx.shadowColor = C.wall;
  ctx.shadowBlur = 8 * dpr;
  ctx.strokeStyle = C.wallCore;
  ctx.lineWidth = 2 * px;
  ctx.lineJoin = 'round';
  // Only where they border the floor, as in the game.
  for (const line of wallLines(draft.outline, draft.blocks)) {
    path(line, false);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  if (tool === 'test') drawTest(px);

  // Handles to drag.
  if (tool === 'move') {
    for (const poly of [draft.outline, ...draft.blocks, ...draft.ramps.map(r => r.area), ...draft.rivers]) {
      poly.forEach((p, i) => {
        const on = hover?.kind === 'vertex' && hover.poly === poly && hover.i === i;
        handle(p, on ? 6 : 4, on ? C.cup : C.wall, px);
      });
    }
    const on = (k: Target['kind']) => hover?.kind === k;
    if (t) handle({ x: t.x + t.w, y: t.y + t.h }, on('tee-size') ? 6 : 4, on('tee-size') ? C.cup : C.mat, px);
    draft.wells.forEach(w => handle(ringHandle(w), 4, w.kind === 'black' ? C.black : C.white, px));
    draft.ramps.forEach(r => handle(arrowTip(r), 4, C.ramp, px));
  }

  // The shape being placed, with a line to the pointer.
  if (drawing.length) {
    ctx.strokeStyle = C.cup;
    ctx.lineWidth = 2 * px;
    path(pointer ? [...drawing, pointer] : drawing, false);
    ctx.stroke();
    drawing.forEach((p, i) => handle(p, i === 0 && drawing.length >= 3 ? 7 : 4, C.cup, px));
  }
  if (pointer && tool !== 'move') handle(pointer, 3, C.muted, px);
}

function drawTest(px: number) {
  const b = test.ball;
  if (!b) return;
  // Probe: where missed shots stop, and the directions that can sink.
  if (test.probe) {
    ctx.fillStyle = 'rgb(238 240 250 / 0.45)';
    for (const e of test.probe.ends) ctx.fillRect(e.x - 1.5 * px, e.y - 1.5 * px, 3 * px, 3 * px);
    for (const a of test.probe.rays) {
      const d = fromAngle(a, 36);
      line(b.pos, { x: b.pos.x + d.x, y: b.pos.y + d.y }, 'rgb(242 177 52 / 0.8)', 1.5 * px);
    }
  }
  if (test.trail.length > 1) {
    ctx.strokeStyle = 'rgb(242 177 52 / 0.7)';
    ctx.lineWidth = 2.5 * px;
    path(test.trail, false);
    ctx.stroke();
  }
  if (!b.sunk) {
    circle(b.pos, CONFIG.ball.radius, C.cup, '#fff8e0', px);
  }
  const aim = test.aim;
  if (aim) {
    const length = lerp(CONFIG.aim.previewMin, CONFIG.aim.previewMax, aim.power);
    const d = fromAngle(aim.angle, length);
    const tip = { x: b.pos.x + d.x, y: b.pos.y + d.y };
    ctx.setLineDash([8 * px, 6 * px]);
    line(b.pos, tip, C.cup, 2 * px);
    ctx.setLineDash([]);
    ctx.fillStyle = C.cup;
    ctx.font = `700 ${12 * px}px Orbitron, sans-serif`;
    ctx.fillText(`${Math.round(aim.power * 100)}%`, tip.x + 8 * px, tip.y);
  }
}

function line(a: Vec, b: Vec, color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function circle(at: Vec, r: number, fill: string, stroke: string, width: number) {
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

function handle(p: Vec, r: number, color: string, px: number) {
  ctx.fillStyle = color;
  ctx.fillRect(p.x - r * px, p.y - r * px, r * 2 * px, r * 2 * px);
}

// --- Start ------------------------------------------------------------------

new ResizeObserver(draw).observe(el.stage);
document.fonts?.ready.then(draw);
setTool('move');
status(kept?.status ?? '');
changed();
void listHoles();
