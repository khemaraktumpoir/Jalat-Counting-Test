import { Box, Frame } from './types';

export interface Letterbox {
  /** 1×3×size×size, RGB, 0–1, channels first (CHW): the model's input. */
  tensor: Float32Array;
  size: number;
  /** source pixel × scale = model pixel */
  scale: number;
  /** Grey bars added on the left / top of the scaled frame (model pixels). */
  padX: number;
  padY: number;
}

// The grey Ultralytics pads with (114 / 255).
const PAD = 114 / 255;

/**
 * Letterboxes a frame to size×size: scaled to fit (aspect kept, bilinear), centered, grey bars
 * around, normalised to 0–1 and laid out channels first.
 */
export function letterbox(frame: Frame, size: number): Letterbox {
  const { data, width, height } = frame;
  const scale = Math.min(size / width, size / height);
  const scaledW = Math.round(width * scale);
  const scaledH = Math.round(height * scale);
  const padX = Math.floor((size - scaledW) / 2);
  const padY = Math.floor((size - scaledH) / 2);

  const plane = size * size;
  const tensor = new Float32Array(3 * plane).fill(PAD);

  for (let y = 0; y < scaledH; y += 1) {
    // Source row for this output row (pixel centers), clamped.
    const sy = Math.min(height - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < scaledW; x += 1) {
      const sx = Math.min(width - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = sx - x0;
      const out = (y + padY) * size + (x + padX);
      const i00 = (y0 * width + x0) * 3;
      const i01 = (y0 * width + x1) * 3;
      const i10 = (y1 * width + x0) * 3;
      const i11 = (y1 * width + x1) * 3;
      for (let c = 0; c < 3; c += 1) {
        const top = data[i00 + c] + (data[i01 + c] - data[i00 + c]) * fx;
        const bottom = data[i10 + c] + (data[i11 + c] - data[i10 + c]) * fx;
        tensor[c * plane + out] = (top + (bottom - top) * fy) / 255;
      }
    }
  }
  return { tensor, size, scale, padX, padY };
}

/** A box in model pixels back to source-frame pixels, kept inside the frame. */
export function toSourceBox(
  box: Box,
  lb: Pick<Letterbox, 'scale' | 'padX' | 'padY'>,
  width: number,
  height: number
): Box {
  const clampX = (v: number) => Math.min(width, Math.max(0, v));
  const clampY = (v: number) => Math.min(height, Math.max(0, v));
  return {
    x1: clampX((box.x1 - lb.padX) / lb.scale),
    y1: clampY((box.y1 - lb.padY) / lb.scale),
    x2: clampX((box.x2 - lb.padX) / lb.scale),
    y2: clampY((box.y2 - lb.padY) / lb.scale)
  };
}
