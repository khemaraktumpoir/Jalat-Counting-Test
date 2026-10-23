import { existsSync, readFileSync } from 'fs';

import type { Box, Frame } from '@lib/counting';

/**
 * The parcel look-alike model (models/parcel-embed.onnx, CLIP's image encoder, made by
 * Jalat-Ultralytics-Service/export_parcel_embedder.py): 512 numbers for the picture of one parcel.
 * Two photos of the same parcel give nearly the same numbers (cosine similarity close to 1), which
 * is how Count photos suggests a parcel already counted in another photo.
 */
export interface Embedder {
  /** One embedding (length 1) per box of the frame, in the boxes' order. */
  embed(frame: Frame, boxes: Box[]): Promise<Float32Array[]>;
}

interface EmbedderMeta {
  size: number;
  mean: [number, number, number];
  std: [number, number, number];
}

/** The model's input for one box: the box's pixels, shorter side to `size`, centre cut, normalised. */
export function boxPixels(
  frame: Frame,
  box: Box,
  meta: EmbedderMeta,
  out: Float32Array,
  at: number
): void {
  const { size, mean, std } = meta;
  const x1 = Math.max(0, Math.min(frame.width - 1, box.x1));
  const y1 = Math.max(0, Math.min(frame.height - 1, box.y1));
  const w = Math.max(1, Math.min(frame.width, box.x2) - x1);
  const h = Math.max(1, Math.min(frame.height, box.y2) - y1);
  // As CLIP's own preprocessing: scale the shorter side to `size`, then keep the middle square.
  const scale = size / Math.min(w, h);
  const offX = (w * scale - size) / 2;
  const offY = (h * scale - size) / 2;
  const plane = size * size;
  for (let y = 0; y < size; y++) {
    const sy = y1 + Math.min(h - 1, Math.max(0, (y + offY + 0.5) / scale - 0.5));
    const y0 = Math.floor(sy);
    const yb = Math.min(frame.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < size; x++) {
      const sx = x1 + Math.min(w - 1, Math.max(0, (x + offX + 0.5) / scale - 0.5));
      const x0 = Math.floor(sx);
      const xb = Math.min(frame.width - 1, x0 + 1);
      const fx = sx - x0;
      for (let c = 0; c < 3; c++) {
        // Bilinear between the four pixels around the point.
        const p = (yy: number, xx: number) => frame.data[(yy * frame.width + xx) * 3 + c];
        const top = p(y0, x0) * (1 - fx) + p(y0, xb) * fx;
        const bottom = p(yb, x0) * (1 - fx) + p(yb, xb) * fx;
        const value = (top * (1 - fy) + bottom * fy) / 255;
        out[at + c * plane + y * size + x] = (value - mean[c]) / std[c];
      }
    }
  }
}

/** Loads the look-alike model, or null when its file is not there (Count photos works without it). */
export async function loadEmbedder(
  modelPath: string,
  provider = 'cpu',
  threads = 0
): Promise<Embedder | null> {
  if (!existsSync(modelPath)) return null;
  const metaPath = modelPath.replace(/\.onnx$/, '.json');
  const meta: EmbedderMeta = existsSync(metaPath)
    ? JSON.parse(readFileSync(metaPath, 'utf8'))
    : {
        size: 224,
        mean: [0.48145466, 0.4578275, 0.40821073],
        std: [0.26862954, 0.26130258, 0.27577711]
      };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ort = require('onnxruntime-node') as typeof import('onnxruntime-node');
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: [provider],
    graphOptimizationLevel: 'all',
    ...(threads > 0 ? { intraOpNumThreads: threads, interOpNumThreads: 1 } : {})
  });
  const [inputName] = session.inputNames;
  const [outputName] = session.outputNames;
  const one = 3 * meta.size * meta.size;

  return {
    async embed(frame, boxes) {
      if (!boxes.length) return [];
      const input = new Float32Array(boxes.length * one);
      boxes.forEach((box, i) => boxPixels(frame, box, meta, input, i * one));
      const tensor = new ort.Tensor('float32', input, [boxes.length, 3, meta.size, meta.size]);
      const result = await session.run({ [inputName]: tensor });
      const data = result[outputName].data as Float32Array;
      const dim = data.length / boxes.length;
      return boxes.map((_, i) => data.slice(i * dim, (i + 1) * dim));
    }
  };
}

/** How alike two embeddings are: 1 the same picture, about 0.9+ the same parcel, lower others. */
export function similarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
