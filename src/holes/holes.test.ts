import { describe, expect, it } from 'vitest';
import { holeToJson, parseHole } from './format';
import { wallLines } from './types';

const files = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' });

const good = {
  name: 'Test',
  par: 3,
  outline: [[0, 0], [360, 0], [360, 900], [0, 900]],
  blocks: [[[150, 400], [210, 400], [180, 460]]],
  tee: { x: 120, y: 790, w: 120, h: 70 },
  cup: [180, 130],
};
const errorsOf = (change: Record<string, unknown>) => parseHole({ ...good, ...change }).errors;

describe('hole files', () => {
  it('has at least one', () => expect(Object.keys(files).length).toBeGreaterThan(0));

  for (const [path, data] of Object.entries(files)) {
    it(`${path} follows the rules`, () => expect(parseHole(data).errors).toEqual([]));
    it(`${path} is saved in the editor's format`, async () => {
      const raw = (await import(`${path}?raw`)) as { default: string };
      expect(raw.default).toBe(holeToJson(parseHole(data).hole!));
    });
  }
});

describe('parseHole', () => {
  it('accepts a good hole and survives a round trip', () => {
    const { hole } = parseHole(good);
    expect(hole).not.toBeNull();
    expect(parseHole(JSON.parse(holeToJson(hole!))).hole).toEqual(hole);
  });

  it('keeps holes inside the frame', () => {
    expect(errorsOf({ outline: [[0, 0], [400, 0], [400, 900], [0, 900]] })).not.toEqual([]);
    expect(errorsOf({ tee: { x: 300, y: 790, w: 120, h: 70 } })).not.toEqual([]);
  });

  it('rejects broken shapes', () => {
    expect(errorsOf({ outline: [[0, 0], [360, 900], [360, 0], [0, 900]] })).toContain('outline: edges must not cross each other');
    const narrow = { outline: [[0, 0], [240, 0], [240, 900], [0, 900]], tee: { x: 60, y: 790, w: 120, h: 70 } };
    expect(errorsOf({ ...narrow, blocks: [[[270, 400], [330, 400], [300, 460]]] })).toContain('block 1: must overlap the course');
  });

  it('lets blocks run into the outline and each other, keeping only the walls on the floor', () => {
    const notch = [[300, 400], [400, 400], [400, 460], [300, 460]].map(([x, y]) => [Math.min(x!, 360), y]);
    const overlapping = [[[150, 400], [210, 400], [180, 460]], [[160, 410], [200, 410], [180, 450]]];
    expect(errorsOf({ blocks: [notch] })).toEqual([]);
    expect(errorsOf({ blocks: [[[0, 0], [90, 0], [0, 90]]] })).toEqual([]); // a triangle filling a corner
    expect(errorsOf({ blocks: overlapping })).toEqual([]);

    // A square notch biting into the right wall.
    const outline = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 900 }, { x: 0, y: 900 }];
    const block = [{ x: 300, y: 400 }, { x: 420, y: 400 }, { x: 420, y: 460 }, { x: 300, y: 460 }];
    const lines = wallLines(outline, [block]);
    const total = lines.reduce((s, l) => s + l.slice(1).reduce((t, p, i) => t + Math.hypot(p.x - l[i]!.x, p.y - l[i]!.y), 0), 0);
    // Outline perimeter 2520, less the 60 the block covers, plus the block's 60 + 60 + 60 inside.
    expect(total).toBeCloseTo(2520 - 60 + 180);

    // A triangle filling the top-left corner leaves just its diagonal there.
    const corner = wallLines(outline, [[{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 0, y: 90 }]]);
    const sum = corner.reduce((s, l) => s + l.slice(1).reduce((t, p, i) => t + Math.hypot(p.x - l[i]!.x, p.y - l[i]!.y), 0), 0);
    expect(sum).toBeCloseTo(2520 - 90 - 90 + Math.hypot(90, 90));
  });

  it('wants the cup and tee on open floor', () => {
    expect(errorsOf({ cup: [180, 430] })).toContain('cup: must be on the floor, clear of the walls');
    expect(errorsOf({ cup: [5, 130] })).toContain('cup: must be on the floor, clear of the walls');
    expect(errorsOf({ tee: { x: 140, y: 380, w: 80, h: 100 } })).toContain('tee: must be on the floor, clear of the walls');
    expect(errorsOf({ cup: [180, 820] })).toContain('cup: must not be on the tee');
  });

  it('accepts every element, and checks where they go', () => {
    const elements = {
      ramps: [{ area: [[0, 500], [360, 500], [360, 600], [0, 600]], angle: 90, strength: 300 }],
      rivers: [[[0, 300], [360, 300], [360, 340], [0, 340]]],
      wells: [{ kind: 'white', at: [100, 450], radius: 60, strength: 600 }],
      portals: [{ color: 'pink', a: [60, 700], b: [300, 220] }],
    };
    const { hole } = parseHole({ ...good, ...elements });
    expect(hole?.ramps[0]?.strength).toBe(300);
    expect(parseHole(JSON.parse(holeToJson(hole!))).hole).toEqual(hole);

    expect(errorsOf({ rivers: [[[0, 100], [360, 100], [360, 160], [0, 160]]] })).toContain('river 1: must not cover the cup');
    expect(errorsOf({ ramps: [{ area: [[0, 760], [360, 760], [360, 880], [0, 880]], angle: 0, strength: 300 }] }))
      .toContain('ramp 1: must not cover the tee');
    expect(errorsOf({ wells: [{ kind: 'black', at: [180, 700], radius: 120, strength: 600 }] }))
      .toContain('black hole 1: its reach must not cover the tee');
    expect(errorsOf({ wells: [{ kind: 'grey', at: [180, 400], radius: 60, strength: 600 }] })).not.toEqual([]);
    expect(errorsOf({ portals: [{ color: 'pink', a: [60, 700], b: [300, 220] }, { color: 'pink', a: [60, 600], b: [300, 320] }] }))
      .toContain('pink portals: one pair per colour');
    expect(errorsOf({ portals: [{ color: 'teal', a: [60, 700], b: [300, 220] }] })).not.toEqual([]);
  });

  it('checks the details', () => {
    expect(errorsOf({ name: '' })).not.toEqual([]);
    expect(errorsOf({ name: 'x'.repeat(40) })).not.toEqual([]);
    expect(errorsOf({ par: 1.5 })).not.toEqual([]);
    expect(parseHole('nope').errors).toEqual(['not a JSON object']);
    expect(parseHole(null).errors).toEqual(['not a JSON object']);
  });
});
