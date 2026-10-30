import type { Vec } from '../engine/vec';

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
