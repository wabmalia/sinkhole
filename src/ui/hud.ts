import { current, type Game } from '../engine/game';
import type { Match } from '../engine/match';
import { holeOf } from '../sets';
import type { MemberView } from '../net/protocol';

// The in-game DOM: HUD, shoot button and how-to card. The canvas only draws
// the course.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  play: $('play'),
  holeName: $('hole-name'),
  players: $('players'),
  slot: $('slot'),
  hint: $('hint'),
  tip: $('tip'),
  flash: $('flash'),
  shootHere: $<HTMLButtonElement>('shoot-here'),
  intro: $('intro'),
  introOk: $<HTMLButtonElement>('intro-ok'),
  toast: $('toast'),
  hourglass: $('hourglass'),
  hgLeft: $('hg-left'),
};

// The hourglass's sand: data blocks like a river's, hexes in rows filling
// each bulb, with links between neighbours. Laid out once; each frame only
// sizes them.
const SVG = 'http://www.w3.org/2000/svg';
const HEX_R = 1.95;
const HEX_W = Math.sqrt(3) * HEX_R;

interface Cell {
  x: number;
  y: number;
  el: SVGPolygonElement;
  size: number;
}

// Half the top bulb's width at height y (0 to 30): wide at the top,
// narrowing to the neck. The bottom bulb is its mirror image.
const bulbHalf = (y: number) => 1.4 + 9.2 * Math.pow(Math.max(0, (29 - y) / 22), 0.7);

// A steady 0 to 1 per block, so the same ones are solid every time.
const solidHash = (n: number) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

const hexPoints = (r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`;
  }).join(' ');

const hg = (() => {
  const cellsG = document.getElementById('hg-cells')!;
  const linksG = document.getElementById('hg-links')!;
  const spots: { x: number; y: number }[] = [];
  for (let row = 0, y = 6 + HEX_R; y < 29; row++, y += HEX_R * 1.5) {
    for (let x = 20 - 12 + (row % 2) * (HEX_W / 2); x < 32; x += HEX_W) {
      if (Math.abs(x - 20) + HEX_R * 0.75 <= bulbHalf(y + HEX_R * 0.5)) spots.push({ x, y });
    }
  }
  const make = (x: number, y: number, n: number, r = HEX_R * 0.8): Cell => {
    const el = document.createElementNS(SVG, 'polygon');
    el.setAttribute('points', hexPoints(r));
    el.setAttribute('class', solidHash(n) < 0.25 ? 'cell solid' : 'cell');
    cellsG.append(el);
    return { x, y, el, size: -1 };
  };
  // The top drains from its surface down; the bottom fills from its floor up.
  const top = [...spots].sort((a, b) => b.y - a.y).map((p, i) => make(p.x, p.y, i));
  const bottom = [...spots].sort((a, b) => a.y - b.y).map((p, i) => make(p.x, 60 - p.y, i + 500));
  const links: { a: Cell; b: Cell; el: SVGLineElement }[] = [];
  for (const bulb of [top, bottom]) {
    for (let i = 0; i < bulb.length; i++) {
      for (let j = i + 1; j < bulb.length; j++) {
        const a = bulb[i]!;
        const b = bulb[j]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) > HEX_W * 1.05) continue;
        const el = document.createElementNS(SVG, 'line');
        el.setAttribute('class', 'link');
        el.setAttribute('x1', `${a.x}`);
        el.setAttribute('y1', `${a.y}`);
        el.setAttribute('x2', `${b.x}`);
        el.setAttribute('y2', `${b.y}`);
        linksG.append(el);
        links.push({ a, b, el });
      }
    }
  }
  // A trickle of small blocks falling through the neck.
  const falling = [0, 1, 2].map(i => make(20, 30, i + 900, HEX_R * 0.5));
  return { top, bottom, links, falling };
})();

const backOut = (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

function sizeCell(c: Cell, size: number) {
  if (Math.abs(size - c.size) < 0.01) return;
  c.size = size;
  c.el.style.display = size <= 0 ? 'none' : '';
  if (size > 0) c.el.setAttribute('transform', `translate(${c.x.toFixed(2)} ${c.y.toFixed(2)}) scale(${size.toFixed(3)})`);
}

export const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

export function onShoot(press: () => void) {
  // pointerdown rather than click: the aim keeps swaying, and a click's
  // delay would fire it somewhere else.
  el.shootHere.addEventListener('pointerdown', e => {
    e.preventDefault();
    press();
  });
  el.shootHere.addEventListener('keydown', e => {
    if (e.key === 'Enter') press();
  });
}

export function showGame(on: boolean) {
  el.play.hidden = !on;
  if (!on) el.intro.hidden = el.shootHere.hidden = true;
}

// How to shoot, in the middle of the screen until dismissed.
export function showIntro(on: boolean) {
  el.intro.hidden = !on || el.play.hidden;
}

export function onIntroDismiss(done: () => void) {
  el.introOk.addEventListener('click', done);
}

// The SHOOT button by the ball, at a screen position, or hidden.
export function placeShoot(at: { x: number; y: number } | null) {
  el.shootHere.hidden = !at || el.play.hidden;
  if (!at) return;
  el.shootHere.style.left = `${at.x}px`;
  el.shootHere.style.top = `${at.y}px`;
}

// Where the course goes: the space the HUD leaves, or the whole screen when
// it's hidden.
export function courseArea(): { x: number; y: number; w: number; h: number } {
  if (el.play.hidden) return { x: 0, y: 0, w: innerWidth, h: innerHeight };
  const r = el.slot.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

// Fewest strokes first; picked up counts as worst.
const byScore = (g: Game) =>
  [...g.players].sort((a, b) => (a.pickedUp ? Infinity : a.strokes) - (b.pickedUp ? Infinity : b.strokes));

export function renderPlayers(g: Game, members: MemberView[], match: Match | null) {
  // Which hole of the set, then its name (cut short if it must be) and par.
  const hole = holeOf(g.holeId);
  const count = document.createElement('b');
  count.textContent = match ? `${match.index + 1}/${match.holes.length}` : '';
  const name = document.createElement('span');
  name.className = 'nm';
  name.textContent = hole.name.toUpperCase();
  const par = document.createElement('span');
  par.textContent = `PAR ${hole.par}`;
  el.holeName.replaceChildren(...(match ? [count] : []), name, par);
  const online = new Map(members.map(m => [m.id, m.connected]));
  el.players.replaceChildren(
    ...byScore(g).map(p => {
      const li = document.createElement('li');
      li.style.setProperty('--c', css(p.color));
      li.classList.toggle('current', g.phase !== 'over' && p === current(g));
      li.classList.toggle('out', p.holed || p.pickedUp);
      li.classList.toggle('away', online.get(p.id) === false);
      li.dataset.name = p.name;
      const dot = document.createElement('span');
      dot.className = 'dot';
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = p.name;
      const strokes = document.createElement('span');
      strokes.className = 'strokes';
      strokes.textContent = p.holed ? `${p.strokes} IN` : p.pickedUp ? 'UP' : String(p.strokes);
      li.append(dot, who, strokes);
      return li;
    }),
  );
  fitPlayers();
}

// Drop the names from the row when they don't all fit on one line.
function fitPlayers() {
  el.players.classList.remove('compact');
  el.players.classList.toggle('compact', el.players.scrollWidth > el.players.clientWidth);
}

// Whether the row is showing names; if not, the scene puts them on the balls.
export const namesInRow = () => !el.players.classList.contains('compact');

window.addEventListener('resize', fitPlayers);

// When the row has no names, tap a player for theirs.
let tipTimer: ReturnType<typeof setTimeout> | undefined;
el.players.addEventListener('pointerdown', e => {
  const li = (e.target as HTMLElement).closest('li');
  if (!li?.dataset.name || namesInRow()) return;
  const r = li.getBoundingClientRect();
  el.tip.textContent = li.dataset.name;
  el.tip.style.setProperty('--c', li.style.getPropertyValue('--c'));
  el.tip.style.left = `${r.left + r.width / 2}px`;
  el.tip.style.top = `${r.bottom + 6}px`;
  el.tip.hidden = false;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => (el.tip.hidden = true), 2000);
});

export function setHint(text: string) {
  el.hint.textContent = text;
}

export function flash(text: string, color?: number) {
  el.flash.textContent = text;
  if (color === undefined) el.flash.style.removeProperty('--c');
  else el.flash.style.setProperty('--c', css(color));
  el.flash.classList.remove('show');
  void el.flash.offsetWidth; // restart the animation
  el.flash.classList.add('show');
}

// The hourglass for a shot running long: `k` from 0 (just shown) to 1 (out
// of time), or null to hide it; `left` is the seconds left.
export function hourglass(k: number | null, left = 0) {
  if (k === null) {
    el.hourglass.hidden = true;
    return;
  }
  el.hourglass.hidden = false;
  const f = Math.min(1, Math.max(0, k));
  // Each block in the top shrinks away in turn, from the surface down; each
  // in the bottom pops in, from the floor up.
  const n = hg.top.length;
  hg.top.forEach((c, i) => sizeCell(c, Math.min(1, Math.max(0, (1 - f) * n - i))));
  hg.bottom.forEach((c, i) => {
    const t = Math.min(1, Math.max(0, f * n - i));
    sizeCell(c, t <= 0 ? 0 : backOut(t));
  });
  for (const l of hg.links) {
    const k = Math.min(l.a.size, l.b.size, 1);
    l.el.style.display = k > 0 ? '' : 'none';
    if (k > 0) l.el.setAttribute('stroke-opacity', (0.5 * k).toFixed(2));
  }
  // Falling to the top of the heap below.
  const heap = hg.bottom.reduce((y, c) => (c.size > 0 ? Math.min(y, c.y) : y), 54);
  const s = performance.now() / 1000;
  hg.falling.forEach((c, i) => {
    if (f >= 1) return sizeCell(c, 0);
    const t = (s * 2.2 + i / 3) % 1;
    c.y = 30 + t * (heap - 30 - HEX_R);
    c.size = -1;
    sizeCell(c, 1);
  });
  el.hgLeft.textContent = `${Math.ceil(left)}`;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), 3500);
}
