import { CONFIG } from '../config';
import { clamp, lerp } from './vec';

const M = CONFIG.meter;

export type Grade = 'perfect' | 'over' | 'under';

export interface Shot {
  angle: number;   // radians, after any bend
  power: number;   // 0..1, after any loss
  grade: Grade;
  miss: number;    // stopped - target, -1..1
}

// Seconds per up-and-down of the bar, set by the power being aimed for.
export function meterCycle(target: number): number {
  return lerp(M.cycleAtMin, M.cycleAtMax, target);
}

// The power bar goes 0 → 1 → 0 once per cycle, and keeps going until stopped.
export function meterAt(seconds: number, target: number): number {
  const phase = (seconds / meterCycle(target)) % 1;
  return phase < 0.5 ? phase * 2 : 2 - phase * 2;
}

// Half-width of the perfect zone around the target power.
export function perfectWindow(target: number): number {
  return lerp(M.windowAtMin, M.windowAtMax, target);
}

// Turn what the player picked (angle, target power) and where they stopped
// the bar into the shot that actually happens.
export function resolveShot(angle: number, target: number, stopped: number): Shot {
  const miss = stopped - target;
  const excess = Math.max(0, Math.abs(miss) - perfectWindow(target));
  if (excess === 0) return { angle, power: target, grade: 'perfect', miss };

  const sign = Math.sign(miss);
  const bendDeg = sign * excess * 10 * lerp(M.bendAtMin, M.bendAtMax, target);
  return {
    angle: angle + (bendDeg * Math.PI) / 180,
    power: clamp(target + sign * excess, CONFIG.aim.minPower, 1),
    grade: sign > 0 ? 'over' : 'under',
    miss,
  };
}
