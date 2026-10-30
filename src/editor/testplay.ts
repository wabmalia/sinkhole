import { CONFIG } from '../config';
import { settle, shotVelocity, type Ball, type Course } from '../engine/physics';
import type { Vec } from '../engine/vec';

// Shots for the editor's test tool, with the game's physics but no sway:
// every shot goes exactly where it's aimed, at exactly the power set.

export const testBall = (at: Vec): Ball => ({ id: 0, pos: { ...at }, vel: { x: 0, y: 0 }, sunk: false });

export function shoot(b: Ball, angle: number, power: number) {
  b.from = { ...b.pos };
  b.vel = shotVelocity(angle, power);
}

export interface Probe {
  tried: number;
  sunk: number;
  rays: number[];       // angles (radians) with at least one power that sinks
  ends: Vec[];          // where the other shots stop
}

const ANGLES = 128;
const POWERS = 12;

// Every direction at a spread of powers from one spot. Runs in slices so the
// page stays responsive; returns a function that stops it.
export function probe(course: Course, from: Vec, progress: (p: Probe, done: boolean) => void): () => void {
  const result: Probe = { tried: 0, sunk: 0, rays: [], ends: [] };
  let i = 0;
  let stopped = false;
  const slice = () => {
    if (stopped) return;
    const until = performance.now() + 30;
    while (i < ANGLES && performance.now() < until) {
      const angle = (i / ANGLES) * Math.PI * 2;
      let sinks = false;
      for (let k = 0; k < POWERS; k++) {
        const power = CONFIG.aim.minPower + ((1 - CONFIG.aim.minPower) * k) / (POWERS - 1);
        const b = testBall(from);
        shoot(b, angle, power);
        const events = settle(course, [b]);
        result.tried++;
        if (b.sunk) {
          result.sunk++;
          sinks = true;
        } else if (!events.some(e => e.type === 'reset')) {
          result.ends.push(b.pos);
        }
      }
      if (sinks) result.rays.push(angle);
      i++;
    }
    progress(result, i >= ANGLES);
    if (i < ANGLES) setTimeout(slice, 0);
  };
  slice();
  return () => (stopped = true);
}
