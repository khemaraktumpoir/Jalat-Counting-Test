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

/**
 * A smaller copy of a frame, at most `maxWidth` wide: shrunk by a whole factor, each pixel the
 * average of its block (lines drawn 2 px wide stay visible). The frame itself when already small
 * enough. For the live preview, which does not need the camera's full size.
 */
export function shrinkFrame(frame: Frame, maxWidth: number): Frame {
  const factor = Math.ceil(frame.width / maxWidth);
  if (factor <= 1) return frame;
  const width = Math.floor(frame.width / factor);
  const height = Math.floor(frame.height / factor);
  const data = new Uint8Array(width * height * 3);
  const area = factor * factor;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        let i = ((y * factor + dy) * frame.width + x * factor) * 3;
        for (let dx = 0; dx < factor; dx += 1, i += 3) {
          r += frame.data[i];
          g += frame.data[i + 1];
          b += frame.data[i + 2];
        }
      }
      const o = (y * width + x) * 3;
      data[o] = Math.round(r / area);
      data[o + 1] = Math.round(g / area);
      data[o + 2] = Math.round(b / area);
    }
  return { data, width, height };
}
