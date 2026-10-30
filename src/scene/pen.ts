import type { Vec } from '../engine/vec';
import { inside } from '../holes/format';
import type { Hole } from '../holes/types';

// What the course drawing needs to draw with. Phaser's Graphics already is
// one (the game); the editor wraps its 2D canvas in one (editor/canvasPen.ts),
// so both draw holes with the same code. Colours are 0xrrggbb numbers.
export interface Pen {
  lineStyle(width: number, color: number, alpha?: number): unknown;
  fillStyle(color: number, alpha?: number): unknown;
  lineBetween(x1: number, y1: number, x2: number, y2: number): unknown;
  fillRect(x: number, y: number, w: number, h: number): unknown;
  fillCircle(x: number, y: number, r: number): unknown;
  strokeCircle(x: number, y: number, r: number): unknown;
  fillPoints(points: Vec[], closeShape?: boolean): unknown;
  strokePoints(points: Vec[], closeShape?: boolean, closePath?: boolean): unknown;
}

// Whether a point is on the floor: inside the outline, outside every block.
export const onFloor = (hole: Pick<Hole, 'outline' | 'blocks'>) => (p: Vec) =>
  inside(p, hole.outline) && !hole.blocks.some(b => inside(p, b));

// A closed line, drawn only where it's on the floor: a ripple stops at the
// walls. Where it crosses one, the crossing is found by halving.
export function onlyOn(fx: Pen, ok: (p: Vec) => boolean, ring: Vec[]) {
  const inner = ring.map(ok);
  if (inner.every(Boolean)) return fx.strokePoints(ring, true, true);
  const edge = (a: Vec, b: Vec) => {
    let [i, o] = [a, b];
    for (let n = 0; n < 6; n++) {
      const m = { x: (i.x + o.x) / 2, y: (i.y + o.y) / 2 };
      if (ok(m)) i = m;
      else o = m;
    }
    return i;
  };
  ring.forEach((a, k) => {
    const j = (k + 1) % ring.length;
    const b = ring[j]!;
    if (inner[k] && inner[j]) fx.lineBetween(a.x, a.y, b.x, b.y);
    else if (inner[k]) {
      const e = edge(a, b);
      fx.lineBetween(a.x, a.y, e.x, e.y);
    } else if (inner[j]) {
      const e = edge(b, a);
      fx.lineBetween(e.x, e.y, b.x, b.y);
    }
  });
}
