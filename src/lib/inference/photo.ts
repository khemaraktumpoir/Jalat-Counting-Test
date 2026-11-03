import { spawn } from 'child_process';
import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js';

import type { Frame } from '@lib/counting';

/** An rgb24 frame as a JPEG (jpeg-js wants RGBA). */
export function frameToJpeg(frame: Frame, quality = 80): Buffer {
  const rgba = Buffer.alloc(frame.width * frame.height * 4);
  for (let i = 0, j = 0; i < frame.data.length; i += 3, j += 4) {
    rgba[j] = frame.data[i];
    rgba[j + 1] = frame.data[i + 1];
    rgba[j + 2] = frame.data[i + 2];
    rgba[j + 3] = 255;
  }
  return encodeJpeg({ data: rgba, width: frame.width, height: frame.height }, quality).data;
}

/** Photos are counted at this size at most (the longer side, in pixels): enough for the model, light on memory. */
export const PHOTO_MAX_SIDE = 1600;

/** The image files a folder count reads (JPEG directly, the others through ffmpeg). */
export const PHOTO_FILE = /\.(jpe?g|png|webp|bmp)$/i;

/** rgb24 pixels scaled to width × height (nearest pixel). */
export function scaleRgb(
  rgb: Uint8Array,
  width: number,
  height: number,
  toWidth: number,
  toHeight: number
): Uint8Array {
  if (width === toWidth && height === toHeight) return rgb;
  const data = new Uint8Array(toWidth * toHeight * 3);
  for (let y = 0; y < toHeight; y++) {
    const sy = Math.min(height - 1, Math.floor((y * height) / toHeight));
    for (let x = 0; x < toWidth; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / toWidth));
      const from = (sy * width + sx) * 3;
      const to = (y * toWidth + x) * 3;
      data[to] = rgb[from];
      data[to + 1] = rgb[from + 1];
      data[to + 2] = rgb[from + 2];
    }
  }
  return data;
}

/** A size that fits in maxSide × maxSide, keeping the photo's shape (never larger than it is). */
export function fitSize(width: number, height: number, maxSide = PHOTO_MAX_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

/** A JPEG photo as an rgb24 frame, at most maxSide on its longer side. */
export function photoFrame(jpeg: Uint8Array, maxSide = PHOTO_MAX_SIDE): Frame {
  const image = decodeJpeg(jpeg, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: 50 });
  const size = fitSize(image.width, image.height, maxSide);
  const data = scaleRgb(
    image.data as Uint8Array,
    image.width,
    image.height,
    size.width,
    size.height
  );
  return { data, ...size };
}

/** Any image file ffmpeg reads (PNG, WebP, BMP…) as one JPEG, at most maxSide on its longer side. */
export function imageFileToJpeg(
  path: string,
  ffmpegPath: string,
  maxSide = PHOTO_MAX_SIDE,
  timeoutMs = 15_000
): Promise<Buffer> {
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', path,
    '-frames:v', '1',
    '-vf', `scale='min(${maxSide},iw)':'min(${maxSide},ih)':force_original_aspect_ratio=decrease`,
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    'pipe:1'
  ]; // prettier-ignore
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('The image took too long to read.'));
    }, timeoutMs);
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    child.on('error', e => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', code => {
      clearTimeout(timer);
      const jpeg = Buffer.concat(chunks);
      if (code === 0 && jpeg.length) resolve(jpeg);
      else reject(new Error(stderr.trim().split('\n').pop() || `ffmpeg exited with ${code}`));
    });
  });
}

/** Two photos whose fingerprints are this many bits apart or fewer show the same scene. */
export const COPY_BITS = 40;

/**
 * A photo's fingerprint: a difference hash of it shrunk to grey 17 x 16 (256 bits, 64 hex
 * characters). The same scene sent twice, or with marks drawn on it, stays within COPY_BITS;
 * other photos are usually more than 100 bits apart.
 */
export function photoFingerprint(frame: Frame, w = 17, h = 16): string {
  const sum = new Float64Array(w * h);
  const n = new Float64Array(w * h);
  for (let y = 0; y < frame.height; y++) {
    const row = Math.min(h - 1, Math.floor((y * h) / frame.height)) * w;
    for (let x = 0; x < frame.width; x++) {
      const i = (y * frame.width + x) * 3;
      const cell = row + Math.min(w - 1, Math.floor((x * w) / frame.width));
      sum[cell] += 0.299 * frame.data[i] + 0.587 * frame.data[i + 1] + 0.114 * frame.data[i + 2];
      n[cell] += 1;
    }
  }
  let hex = '';
  let nibble = 0;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = sum[y * w + x] / (n[y * w + x] || 1);
      const b = sum[y * w + x + 1] / (n[y * w + x + 1] || 1);
      nibble = (nibble << 1) | (a > b ? 1 : 0);
      if (++count % 4 === 0) {
        hex += nibble.toString(16);
        nibble = 0;
      }
    }
  }
  return hex;
}

/** How many bits two fingerprints differ by (256 when one is missing). */
export function fingerprintDistance(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  if (!a || !b || a.length !== b.length) return 256;
  let bits = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      bits += x & 1;
      x >>= 1;
    }
  }
  return bits;
}
