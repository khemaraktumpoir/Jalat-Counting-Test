import { DetectOptions } from './detector';
import { Detection, Frame } from './types';

/**
 * Demo detector (MODEL_PATH=demo:orange): finds orange parcels (Jalat orange tape / boxes) by colour,
 * without a model. For trying the whole system — the sample video, the dashboard, the counts — before
 * the YOLO26 model is there. Not for real counting.
 */
export class ColorDetector {
  /** Grid step in pixels: the frame is read on this grid (8 = 1 pixel in 64). */
  constructor(private readonly step = 8, private readonly minCells = 12) {}

  async detect(frame: Frame, _options: DetectOptions): Promise<Detection[]> {
    const { data, width, height } = frame;
    const cols = Math.floor(width / this.step);
    const rows = Math.floor(height / this.step);
    const mask = new Uint8Array(cols * rows);
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        const i = (gy * this.step * width + gx * this.step) * 3;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r > 150 && r - g > 40 && r - b > 100) mask[gy * cols + gx] = 1;
      }
    }
    // Connected cells (4 neighbours) → one box each.
    const seen = new Uint8Array(cols * rows);
    const detections: Detection[] = [];
    const stack: number[] = [];
    for (let start = 0; start < mask.length; start += 1) {
      if (!mask[start] || seen[start]) continue;
      let minX = cols, minY = rows, maxX = 0, maxY = 0, cells = 0; // prettier-ignore
      stack.push(start);
      seen[start] = 1;
      while (stack.length) {
        const cell = stack.pop()!;
        const x = cell % cols;
        const y = (cell - x) / cols;
        cells += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        const next = [
          x > 0 ? cell - 1 : -1,
          x < cols - 1 ? cell + 1 : -1,
          y > 0 ? cell - cols : -1,
          y < rows - 1 ? cell + cols : -1
        ];
        for (const n of next) {
          if (n >= 0 && mask[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
      if (cells < this.minCells) continue;
      detections.push({
        box: {
          x1: minX * this.step,
          y1: minY * this.step,
          x2: (maxX + 1) * this.step,
          y2: (maxY + 1) * this.step
        },
        score: 0.99,
        classId: 0
      });
    }
    return detections;
  }
}

export const DEMO_MODEL = 'demo:orange';
export const DEMO_LABELS: Record<number, string> = { 0: 'parcel' };
