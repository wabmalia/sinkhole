import { CONFIG } from '../config';
import { lerp } from './vec';

// A shot as sent to the host: where the swaying aim pointed when SHOOT was
// pressed, and the power the drag set.
export interface Shot {
  angle: number;   // radians
  power: number;   // 0..1
}

// Seconds per full swing of the aim: faster on harder shots.
export const swayCycle = (power: number): number => lerp(CONFIG.sway.cycleAtMin, CONFIG.sway.cycleAtMax, power);

// How far off the aim is (radians) at a point in its swing (in whole swings).
export const swayOf = (phase: number): number => ((CONFIG.sway.degrees * Math.PI) / 180) * Math.sin(phase * Math.PI * 2);

// How far off the aim is (radians) after swinging for a while at one power.
export const swayAt = (seconds: number, power: number): number => swayOf(seconds / swayCycle(power));
