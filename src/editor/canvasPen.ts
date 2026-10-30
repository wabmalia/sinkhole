import type { Pen } from '../scene/pen';
import type { Vec } from '../engine/vec';

// The game's drawing calls on a 2D canvas, so the editor draws holes exactly
// as the game does. Widths and positions are in whatever units the canvas
// transform is set to.
export function canvasPen(ctx: CanvasRenderingContext2D): Pen {
  const rgb = (c: number, a = 1) => `rgb(${(c >> 16) & 255} ${(c >> 8) & 255} ${c & 255} / ${a})`;
  let stroke = '';
  let width = 1;
  let fill = '';
  const path = (points: Vec[], close: boolean) => {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (close) ctx.closePath();
  };
  const draw = () => {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  return {
    lineStyle(w, c, a) {
      width = w;
      stroke = rgb(c, a);
    },
    fillStyle(c, a) {
      fill = rgb(c, a);
    },
    lineBetween(x1, y1, x2, y2) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      draw();
    },
    fillRect(x, y, w, h) {
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
    },
    fillCircle(x, y, r) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
    },
    strokeCircle(x, y, r) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      draw();
    },
    fillPoints(points, close = true) {
      path(points, close);
      ctx.fillStyle = fill;
      ctx.fill();
    },
    strokePoints(points, close = false) {
      path(points, close);
      draw();
    },
  };
}
