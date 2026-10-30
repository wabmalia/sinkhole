import type { Course } from '../engine/physics';
import { courseFrom, type Hole } from '../holes/types';
import { BROWSER_PREFIX, browserSets, isBrowserSet, onBrowserSets } from './browser';
import { DEFAULT_SET, parseSet, type HoleSet } from './format';

export { DEFAULT_SET } from './format';
export { isBrowserSet } from './browser';

// Every set by id: the JSON files in this folder, named <id>.json, and the
// ones saved in this browser (ids starting "my:"). A file that breaks the
// rules is left out (and, in the repo, fails the tests).
//
// The game state refers to a hole by a key, "<set id>/<number>" counting
// from 0, so it stays small enough to send over the network.
const files = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' });

export const BUILT: Record<string, HoleSet> = {};
for (const [path, data] of Object.entries(files)) {
  const id = path.slice(2, -'.json'.length);
  const { set, errors } = parseSet(data);
  if (set) BUILT[id] = set;
  else console.warn(`[sinkhole] set ${id} left out:`, errors);
}

let SETS: Record<string, HoleSet> = {};
const courses = new Map<string, Course>();

function load() {
  SETS = { ...BUILT };
  for (const [id, data] of Object.entries(browserSets())) {
    const { set } = parseSet(data);
    if (set) SETS[BROWSER_PREFIX + id] = set;
  }
  courses.clear();
}
load();
onBrowserSets(load);

export function setOf(id: string): HoleSet {
  return SETS[id] ?? SETS[DEFAULT_SET]!;
}

export const hasSet = (id: unknown): id is string => typeof id === 'string' && Object.hasOwn(SETS, id);

// The lobby's list, shortest first; the browser's sets only when asked for.
export const setIds = (withBrowser = false) =>
  Object.keys(SETS)
    .filter(id => withBrowser || !isBrowserSet(id))
    .sort((a, b) => SETS[a]!.holes.length - SETS[b]!.holes.length || SETS[a]!.name.localeCompare(SETS[b]!.name));

export const holeKeys = (setId: string) => setOf(setId).holes.map((_, i) => `${setId}/${i}`);

// The first hole of the default set, for anything that needs one.
export const DEFAULT_HOLE = `${DEFAULT_SET}/0`;

export function holeOf(key: string): Hole {
  const cut = key.lastIndexOf('/');
  const set = SETS[key.slice(0, cut)];
  return set?.holes[Number(key.slice(cut + 1))] ?? SETS[DEFAULT_SET]!.holes[0]!;
}

export function courseOf(key: string): Course {
  let c = courses.get(key);
  if (!c) {
    c = courseFrom(holeOf(key));
    courses.set(key, c);
  }
  return c;
}

// The total par of a run of holes.
export const parOf = (keys: string[]) => keys.reduce((sum, key) => sum + holeOf(key).par, 0);
