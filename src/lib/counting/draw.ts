import { Box, Frame, Point } from './types';

export type RGB = [number, number, number];

export const COLORS = {
  box: [247, 148, 31] as RGB, // Jalat orange
  region: [37, 99, 235] as RGB,
  inArrow: [22, 163, 74] as RGB
};

function setPixel(frame: Frame, x: number, y: number, color: RGB): void {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= frame.width || py >= frame.height) return;
  const i = (py * frame.width + px) * 3;
  frame.data[i] = color[0];
  frame.data[i + 1] = color[1];
  frame.data[i + 2] = color[2];
}

/** A straight line `thickness` pixels wide (in place). */
export function drawLine(frame: Frame, a: Point, b: Point, color: RGB, thickness = 2): void {
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
  const half = Math.floor(thickness / 2);
  for (let s = 0; s <= steps; s += 1) {
    const x = a.x + ((b.x - a.x) * s) / steps;
    const y = a.y + ((b.y - a.y) * s) / steps;
    for (let dx = -half; dx <= half; dx += 1)
      for (let dy = -half; dy <= half; dy += 1) setPixel(frame, x + dx, y + dy, color);
  }
}

export function drawBox(frame: Frame, box: Box, color: RGB, thickness = 2): void {
  drawLine(frame, { x: box.x1, y: box.y1 }, { x: box.x2, y: box.y1 }, color, thickness);
  drawLine(frame, { x: box.x2, y: box.y1 }, { x: box.x2, y: box.y2 }, color, thickness);
  drawLine(frame, { x: box.x2, y: box.y2 }, { x: box.x1, y: box.y2 }, color, thickness);
  drawLine(frame, { x: box.x1, y: box.y2 }, { x: box.x1, y: box.y1 }, color, thickness);
}

export function drawPolyline(
  frame: Frame,
  points: Point[],
  color: RGB,
  closed: boolean,
  thickness = 3
): void {
  for (let i = 0; i < points.length - 1; i += 1)
    drawLine(frame, points[i], points[i + 1], color, thickness);
  if (closed && points.length > 2)
    drawLine(frame, points[points.length - 1], points[0], color, thickness);
}

/** A short arrow from the middle of a→b towards its IN side (the left of a→b, y down). */
export function drawInArrow(frame: Frame, a: Point, b: Point, color: RGB): void {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  // Left normal of a→b in y-down coordinates.
  const n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
  const tip = { x: mid.x + n.x * 40, y: mid.y + n.y * 40 };
  drawLine(frame, mid, tip, color, 3);
  const back = { x: tip.x - n.x * 12, y: tip.y - n.y * 12 };
  const side = { x: -n.y * 8, y: n.x * 8 };
  drawLine(frame, tip, { x: back.x + side.x, y: back.y + side.y }, color, 3);
  drawLine(frame, tip, { x: back.x - side.x, y: back.y - side.y }, color, 3);
}
