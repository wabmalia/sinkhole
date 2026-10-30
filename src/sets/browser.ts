import { setToJson, type HoleSet } from './format';

// Sets saved in this browser by the editor, which PLAY SOLO can play too (the
// editor and the game share the origin, so the same storage). Kept as their
// files, by file name, and checked again whenever they're read.

const KEY = 'sinkhole-sets';

// Their ids in the game, so they never clash with the sets built in.
export const BROWSER_PREFIX = 'my:';
export const isBrowserSet = (id: string) => id.startsWith(BROWSER_PREFIX);

export function browserSets(): Record<string, unknown> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    const all: unknown = raw ? JSON.parse(raw) : {};
    return all && typeof all === 'object' && !Array.isArray(all) ? (all as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// False if storage is off or full.
export function saveBrowserSet(id: string, set: HoleSet): boolean {
  return write({ ...browserSets(), [id]: JSON.parse(setToJson(set)) as unknown });
}

export function deleteBrowserSet(id: string): boolean {
  const all = browserSets();
  delete all[id];
  return write(all);
}

function write(all: Record<string, unknown>): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

// Another tab (the editor) saved or deleted one.
export function onBrowserSets(change: () => void) {
  if (typeof window !== 'undefined') window.addEventListener('storage', e => e.key === KEY && change());
}
