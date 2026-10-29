import type { Hole } from './types';

// The tuning hole: a plain straight lane, tee at the bottom, cup at the top.
export const straight: Hole = {
  name: 'Straight',
  par: 2,
  outline: [
    { x: 0, y: 0 },
    { x: 360, y: 0 },
    { x: 360, y: 900 },
    { x: 0, y: 900 },
  ],
  blocks: [],
  tee: { x: 120, y: 790, w: 120, h: 70 },
  cup: { x: 180, y: 130 },
};
