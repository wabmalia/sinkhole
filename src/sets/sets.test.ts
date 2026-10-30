import { afterEach, describe, expect, it } from 'vitest';
import { deleteBrowserSet, isBrowserSet, saveBrowserSet } from './browser';
import { parseSet, setToJson } from './format';
import { DEFAULT_HOLE, DEFAULT_SET, hasSet, holeKeys, holeOf, parOf, setIds, setOf } from '.';

const files = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' });

const hole = (name: string, par = 3) => ({
  name,
  par,
  outline: [[0, 0], [360, 0], [360, 900], [0, 900]],
  blocks: [],
  tee: { x: 120, y: 790, w: 120, h: 70 },
  cup: [180, 130],
});

describe('set files', () => {
  it('has the default set', () => expect(hasSet(DEFAULT_SET)).toBe(true));

  for (const [path, data] of Object.entries(files)) {
    it(`${path} follows the rules`, () => expect(parseSet(data).errors).toEqual([]));
    it(`${path} is saved in the editor's format`, async () => {
      const raw = (await import(`${path}?raw`)) as { default: string };
      expect(raw.default).toBe(setToJson(parseSet(data).set!));
    });
  }
});

describe('hole keys', () => {
  it('finds a hole by its set and number', () => {
    expect(holeKeys(DEFAULT_SET)[0]).toBe(DEFAULT_HOLE);
    expect(holeOf(`${DEFAULT_SET}/1`)).toBe(setOf(DEFAULT_SET).holes[1]);
  });

  it('falls back to the default hole', () => {
    expect(holeOf('nope/0')).toBe(holeOf(DEFAULT_HOLE));
    expect(holeOf(`${DEFAULT_SET}/99`)).toBe(holeOf(DEFAULT_HOLE));
  });

  it('adds up par', () => expect(parOf(holeKeys(DEFAULT_SET))).toBe(setOf(DEFAULT_SET).holes.reduce((s, h) => s + h.par, 0)));
});

describe('parseSet', () => {
  const good = { name: 'Two', holes: [hole('One'), hole('Two', 4)] };

  it('accepts a good set and survives a round trip', () => {
    const { set } = parseSet(good);
    expect(set!.holes.map(h => h.name)).toEqual(['One', 'Two']);
    expect(parseSet(JSON.parse(setToJson(set!))).set).toEqual(set);
  });

  it('needs a name and 1 to 18 good holes', () => {
    expect(parseSet({ ...good, name: ' ' }).errors).toHaveLength(1);
    expect(parseSet({ ...good, holes: [] }).errors).toHaveLength(1);
    expect(parseSet({ ...good, holes: Array(19).fill(hole('x')) }).errors).toHaveLength(1);
    const errors = parseSet({ ...good, holes: [hole('ok'), { ...hole('bad'), par: 9 }, 3] }).errors;
    expect(errors.some(e => e.startsWith('hole 2: '))).toBe(true);
    expect(errors.some(e => e.startsWith('hole 3: '))).toBe(true);
    expect(errors.some(e => e.startsWith('hole 1: '))).toBe(false);
    expect(parseSet('x').set).toBeNull();
  });
});

describe('sets saved in the browser', () => {
  const store = new Map<string, string>();
  globalThis.localStorage ??= {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: k => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  afterEach(() => deleteBrowserSet('mine'));

  it('keeps them apart from the built-in ones', async () => {
    const set = parseSet({ name: 'Mine', holes: [hole('Only')] }).set!;
    expect(saveBrowserSet('mine', set)).toBe(true);
    // The registry reads them on load; a fresh copy of it sees this one.
    const { vi } = await import('vitest');
    vi.resetModules();
    const fresh = await import('.');
    expect(fresh.hasSet('my:mine')).toBe(true);
    expect(isBrowserSet('my:mine')).toBe(true);
    expect(fresh.holeOf('my:mine/0').name).toBe('Only');
    expect(fresh.setIds()).not.toContain('my:mine');
    expect(fresh.setIds(true)).toContain('my:mine');
    expect(setIds()).not.toContain('my:mine');
  });
});
