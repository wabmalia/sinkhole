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
};

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

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), 3500);
}
