import { CONFIG } from '../config';
import { lerp } from './vec';

// A shot as sent to the host: where the swaying aim pointed when SHOOT was
// pressed, and the power the drag set.
export interface Shot {
  angle: number;   // radians
  power: number;   // 0..1
}

// How far off the aim is (radians) at a moment: it swings either side,
// faster on harder shots.
export function swayAt(seconds: number, power: number): number {
  const S = CONFIG.sway;
  const cycle = lerp(S.cycleAtMin, S.cycleAtMax, power);
  return ((S.degrees * Math.PI) / 180) * Math.sin((seconds / cycle) * Math.PI * 2);
}
