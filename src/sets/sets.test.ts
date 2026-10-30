import { describe, expect, it } from 'vitest';
import { HOLES } from '../holes';
import { parseSet, setToJson } from './format';
import { DEFAULT_SET, parOf, SETS, setIds } from '.';

const files = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' });
const known = Object.keys(HOLES);

describe('set files', () => {
  it('has the default set', () => expect(SETS[DEFAULT_SET]).toBeDefined());

  for (const [path, data] of Object.entries(files)) {
    it(`${path} follows the rules`, () => expect(parseSet(data, known).errors).toEqual([]));
    it(`${path} is saved in the editor's format`, async () => {
      const raw = (await import(`${path}?raw`)) as { default: string };
      expect(raw.default).toBe(setToJson(parseSet(data, known).set!));
    });
  }

  it('lists the shortest first', () => {
    const ids = setIds();
    expect(ids[0]).toBe(DEFAULT_SET);
    expect(SETS[ids.at(-1)!]!.holes.length).toBeGreaterThanOrEqual(SETS[ids[0]!]!.holes.length);
  });

  it('adds up par', () => expect(parOf(['straight', 'splash'])).toBe(5));
});

describe('parseSet', () => {
  const good = { name: 'Two', holes: ['straight', 'straight'] };

  it('accepts a good set, repeats included, and survives a round trip', () => {
    const { set } = parseSet(good, known);
    expect(set).toEqual(good);
    expect(parseSet(JSON.parse(setToJson(set!)), known).set).toEqual(set);
  });

  it('needs a name and 1 to 18 known holes', () => {
    expect(parseSet({ ...good, name: ' ' }, known).errors).toHaveLength(1);
    expect(parseSet({ ...good, holes: [] }, known).errors).toHaveLength(1);
    expect(parseSet({ ...good, holes: Array(19).fill('straight') }, known).errors).toHaveLength(1);
    expect(parseSet({ ...good, holes: ['straight', 'nope', 3] }, known).errors).toEqual([
      'hole 2: no hole called "nope"',
      'hole 3: a hole id',
    ]);
    expect(parseSet('x', known).set).toBeNull();
  });
});
