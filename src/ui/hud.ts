import { current, type Game } from '../engine/game';
import { perfectWindow, type Shot } from '../engine/shot';
import { holeOf } from '../holes';
import type { MemberView } from '../net/protocol';

// The in-game DOM: HUD, power bar and shoot button. The canvas only draws
// the course.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  hud: $('hud'),
  holeName: $('hole-name'),
  players: $('players'),
  controls: $('controls'),
  hint: $('hint'),
  meter: $('meter'),
  meterWindow: $('meter-window'),
  meterFill: $('meter-fill'),
  meterTarget: $('meter-target'),
  power: $('power'),
  shoot: $<HTMLButtonElement>('shoot'),
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
  el.hud.hidden = !on;
  el.controls.hidden = !on;
}

// Space for the canvas-free elements so the scene can fit the course between.
export function reservedSpace(): { top: number; bottom: number } {
  return {
    top: el.hud.hidden ? 0 : el.hud.getBoundingClientRect().bottom,
    bottom: el.controls.hidden ? 0 : el.controls.getBoundingClientRect().height,
  };
}

export function renderPlayers(g: Game, members: MemberView[]) {
  const hole = holeOf(g.holeId);
  el.holeName.textContent = `${hole.name.toUpperCase()} · PAR ${hole.par}`;
  const online = new Map(members.map(m => [m.id, m.connected]));
  el.players.replaceChildren(
    ...g.players.map(p => {
      const li = document.createElement('li');
      li.style.setProperty('--c', css(p.color));
      li.classList.toggle('current', g.phase !== 'over' && p === current(g));
      li.classList.toggle('out', p.holed || p.pickedUp);
      li.classList.toggle('away', online.get(p.id) === false);
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
}

// 'aim' and 'meter' are my turn; 'watch' is someone else's or a shot rolling.
export type ControlState = 'aim' | 'meter' | 'watch';

export function renderControls(state: ControlState, power: number, hint: string) {
  el.power.textContent = `POWER ${pct(power)}`;
  el.hint.textContent = hint;
  const w = perfectWindow(power);
  el.meterTarget.style.left = exact(power);
  el.meterWindow.style.left = exact(Math.max(0, power - w));
  el.meterWindow.style.width = exact(Math.min(1, power + w) - Math.max(0, power - w));
  el.shoot.disabled = state === 'watch';
  el.shoot.textContent = state === 'meter' ? 'STOP' : 'SHOOT';
  el.shoot.classList.toggle('stop', state === 'meter');
}

export function setMeter(v: number) {
  el.meterFill.style.width = exact(v);
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
