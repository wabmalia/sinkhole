import { current, type Game } from '../engine/game';
import { perfectWindow, type Shot } from '../engine/shot';
import { holeOf } from '../holes';
import type { MemberView } from '../net/protocol';

// The in-game DOM: HUD, power bar and shoot button. The canvas only draws
// the course.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  play: $('play'),
  holeName: $('hole-name'),
  players: $('players'),
  slot: $('slot'),
  hint: $('hint'),
  meter: $('meter'),
  meterWindow: $('meter-window'),
  meterFill: $('meter-fill'),
  meterTarget: $('meter-target'),
  power: $('power'),
  shoot: $<HTMLButtonElement>('shoot'),
  tip: $('tip'),
  flash: $('flash'),
  toast: $('toast'),
};

export const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
// Exact, for positioning: rounding to whole percents would knock the zone off
// centre and make the fill step past it.
const exact = (v: number) => `${v * 100}%`;

export function onShoot(press: () => void) {
  // pointerdown rather than click: the second press stops the bar, and a
  // click's delay would cost accuracy.
  el.shoot.addEventListener('pointerdown', e => {
    e.preventDefault();
    press();
  });
  el.shoot.addEventListener('keydown', e => {
    if (e.key === 'Enter') press();
  });
}

export function showGame(on: boolean) {
  el.play.hidden = !on;
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

export function renderPlayers(g: Game, members: MemberView[]) {
  const hole = holeOf(g.holeId);
  el.holeName.textContent = `${hole.name.toUpperCase()} · PAR ${hole.par}`;
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

// 'aim' and 'meter' are my turn; 'watch' is someone else's or a shot rolling.
export type ControlState = 'aim' | 'meter' | 'watch';

export function renderControls(state: ControlState, power: number, hint: string) {
  el.power.textContent = pct(power);
  el.hint.textContent = hint;
  const w = perfectWindow(power);
  el.meterTarget.style.bottom = exact(power);
  el.meterWindow.style.bottom = exact(Math.max(0, power - w));
  el.meterWindow.style.height = exact(Math.min(1, power + w) - Math.max(0, power - w));
  el.shoot.disabled = state === 'watch';
  el.shoot.textContent = state === 'meter' ? 'STOP' : 'SHOOT';
  el.shoot.classList.toggle('stop', state === 'meter');
}

export function setMeter(v: number) {
  el.meterFill.style.height = exact(v);
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

export function shotText(s: Shot): string {
  if (s.grade === 'perfect') return 'PERFECT';
  const off = Math.round(Math.abs(s.miss) * 100);
  return s.grade === 'over' ? `OVER +${off}%` : `UNDER -${off}%`;
}
