import { parseHole } from './format';
import { courseFrom, type Hole } from './types';
import type { Course } from '../engine/physics';

// Every hole by id: the JSON files in this folder, named <id>.json. The game
// state refers to holes by id so it stays small enough to send over the
// network. A file that breaks the rules is left out (and fails the tests).
const files = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' });

export const HOLES: Record<string, Hole> = {};
for (const [path, data] of Object.entries(files)) {
  const id = path.slice(2, -'.json'.length);
  const { hole, errors } = parseHole(data);
  if (hole) HOLES[id] = hole;
  else console.warn(`[sinkhole] hole ${id} left out:`, errors);
}

export const DEFAULT_HOLE = 'straight';

const courses = new Map<string, Course>();

export function holeOf(id: string): Hole {
  return HOLES[id] ?? HOLES[DEFAULT_HOLE]!;
}

export function courseOf(id: string): Course {
  let c = courses.get(id);
  if (!c) {
    c = courseFrom(holeOf(id));
    courses.set(id, c);
  }
  return c;
}
