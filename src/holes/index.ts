import { straight } from './straight';
import { wallsOf, type Hole } from './types';
import type { Course } from '../engine/physics';

// Every hole by id. The game state refers to holes by id so it stays small
// enough to send over the network.
export const HOLES: Record<string, Hole> = { straight };

const courses = new Map<string, Course>();

export function holeOf(id: string): Hole {
  return HOLES[id] ?? straight;
}

export function courseOf(id: string): Course {
  let c = courses.get(id);
  if (!c) {
    const hole = holeOf(id);
    c = { walls: wallsOf(hole), cup: hole.cup };
    courses.set(id, c);
  }
  return c;
}
