import { HOLES, holeOf } from '../holes';
import { parseSet, type HoleSet } from './format';

// Every set by id: the JSON files in this folder, named <id>.json. A file
// that breaks the rules is left out (and fails the tests).
const files = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' });

export const SETS: Record<string, HoleSet> = {};
for (const [path, data] of Object.entries(files)) {
  const id = path.slice(2, -'.json'.length);
  const { set, errors } = parseSet(data, Object.keys(HOLES));
  if (set) SETS[id] = set;
  else console.warn(`[sinkhole] set ${id} left out:`, errors);
}

export const DEFAULT_SET = 'full-course';

export function setOf(id: string): HoleSet {
  return SETS[id] ?? SETS[DEFAULT_SET]!;
}

export const hasSet = (id: unknown): id is string => typeof id === 'string' && Object.hasOwn(SETS, id);

// The total par of a run of holes.
export const parOf = (holes: string[]) => holes.reduce((sum, id) => sum + holeOf(id).par, 0);

// Shortest first, as the lobby lists them.
export const setIds = () =>
  Object.keys(SETS).sort((a, b) => SETS[a]!.holes.length - SETS[b]!.holes.length || SETS[a]!.name.localeCompare(SETS[b]!.name));
