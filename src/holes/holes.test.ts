import { describe, expect, it } from 'vitest';
import { holeToJson, parseHole, tidyHoleFile, tidyPolygon } from './format';
import { curveThrough, solid, wallLines } from './types';

const good = {
  name: 'Test',
  par: 3,
  outline: [[0, 0], [360, 0], [360, 900], [0, 900]],
  blocks: [[[150, 400], [210, 400], [180, 460]]],
  tee: { x: 120, y: 790, w: 120, h: 70 },
  cup: [180, 130],
};
const errorsOf = (change: Record<string, unknown>) => parseHole({ ...good, ...change }).errors;

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
      mud: [[[0, 620], [120, 620], [120, 700], [0, 700]]],
      wells: [{ kind: 'white', at: [100, 450], radius: 60, strength: 600 }],
      portals: [{ color: 'pink', a: [60, 700], b: [300, 220] }],
    };
    const { hole } = parseHole({ ...good, ...elements });
    expect(hole?.ramps[0]?.strength).toBe(300);
    expect(parseHole(JSON.parse(holeToJson(hole!))).hole).toEqual(hole);

    expect(errorsOf({ rivers: [[[0, 100], [360, 100], [360, 160], [0, 160]]] })).toContain('river 1: must not cover the cup');
    expect(hole?.mud).toHaveLength(1);
    expect(errorsOf({ mud: [[[0, 100], [360, 100], [360, 160], [0, 160]]] })).toContain('mud 1: must not cover the cup');
    expect(errorsOf({ mud: [[[0, 760], [360, 760], [360, 880], [0, 880]]] })).toContain('mud 1: must not cover the tee');
    // A cup on a slope is fine.
    expect(errorsOf({ ramps: [{ area: [[0, 100], [360, 100], [360, 160], [0, 160]], angle: 0, strength: 300 }] })).toEqual([]);
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

describe('round blocks', () => {
  const peg = (x: number, y: number, radius = 10) => ({ at: [x, y], radius });

  it('accepts them next to cornered ones, and survives a round trip', () => {
    const { hole, errors } = parseHole({ ...good, blocks: [...good.blocks, peg(100, 300), peg(260, 600, 20)] });
    expect(errors).toEqual([]);
    expect(hole!.blocks[1]).toEqual({ at: { x: 100, y: 300 }, radius: 10 });
    expect(parseHole(JSON.parse(holeToJson(hole!))).hole).toEqual(hole);
  });

  it('checks their size and place', () => {
    expect(errorsOf({ blocks: [peg(100, 300, 2)] })).toContain('block 1: radius from 6 to 150');
    expect(errorsOf({ blocks: [{ at: [100] , radius: 10 }] })).toContain('block 1: at, an [x, y] point');
    expect(errorsOf({ blocks: [peg(180, 140, 20)] })).toContain('cup: must be on the floor, clear of the walls');
  });

  it('allow up to 32 blocks, enough for a plinko board', () => {
    const pegs = (n: number) => Array.from({ length: n }, (_, i) => peg(40 + (i % 8) * 40, 250 + Math.floor(i / 8) * 80, 8));
    expect(errorsOf({ blocks: pegs(32) })).toEqual([]);
    expect(errorsOf({ blocks: pegs(33) })).toContain('blocks: at most 32');
  });

  it('make a closed round wall', () => {
    const lines = wallLines(good.outline.map(([x, y]) => ({ x: x!, y: y! })), [solid({ at: { x: 180, y: 450 }, radius: 20 })]);
    expect(lines).toHaveLength(2);
  });
});

describe('tidying', () => {
  const v = (pts: number[][]) => pts.map(([x, y]) => ({ x: x!, y: y! }));

  it('drops corners in the middle of a straight side', () => {
    expect(tidyPolygon(v([[0, 0], [100, 0], [200, 0], [200, 100], [0, 100], [0, 50]])))
      .toEqual(expect.arrayContaining(v([[0, 0], [200, 0], [200, 100], [0, 100]])));
    expect(tidyPolygon(v([[0, 0], [100, 0], [200, 0], [200, 100], [0, 100], [0, 50]]))).toHaveLength(4);
  });

  it('drops a spike that doubles back, and repeated corners', () => {
    expect(tidyPolygon(v([[0, 0], [200, 0], [300, 0], [200, 0], [200, 100], [0, 100]]))).toHaveLength(4);
    expect(tidyPolygon(v([[0, 0], [0, 0], [200, 0], [200, 100], [0, 100]]))).toHaveLength(4);
  });

  it('keeps real corners, and leaves round blocks alone', () => {
    const tri = v([[0, 0], [200, 0], [100, 100]]);
    expect(tidyPolygon(tri)).toEqual(tri);
    const { file, removed } = tidyHoleFile({ ...good, blocks: [...good.blocks, { at: [100, 300], radius: 10 }] } as never);
    expect(removed).toBe(0);
    expect(file.blocks![1]).toEqual({ at: [100, 300], radius: 10 });
  });
});

describe('smooth blocks', () => {
  const corners = [[150, 400], [210, 400], [210, 460], [150, 460]];

  it('curve through every corner they were drawn with', () => {
    const pts = corners.map(([x, y]) => ({ x: x!, y: y! }));
    const curve = curveThrough(pts);
    for (const p of pts) expect(curve).toContainEqual(p);
    // Round, not square: the middle of a side bulges out past the straight line.
    expect(Math.min(...curve.map(p => p.y))).toBeLessThan(400);
  });

  it('survive a round trip, keeping their corners', () => {
    const { hole, errors } = parseHole({ ...good, blocks: [{ smooth: corners }] });
    expect(errors).toEqual([]);
    expect(hole!.blocks[0]).toEqual({ smooth: corners.map(([x, y]) => ({ x, y })) });
    expect(parseHole(JSON.parse(holeToJson(hole!))).hole).toEqual(hole);
  });

  it('are left alone by tidying, whose corners shape the curve', () => {
    const { removed } = tidyHoleFile({ ...good, blocks: [{ smooth: [[150, 400], [180, 400], [210, 400], [180, 460]] }] } as never);
    expect(removed).toBe(0);
  });
});
