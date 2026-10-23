import { encode as encodeJpeg } from 'jpeg-js';

import type { DetectOptions } from './detector';
import type { DetectorLike } from './pipeline';
import type { Detection, Frame } from './types';

/**
 * MODEL_PATH=ultralytics:<url>: the model runs on Ultralytics Platform instead of this server.
 * The url is a dedicated endpoint (https://….run.app/predict, no rate limit) or the shared one
 * (https://platform.ultralytics.com/api/models/<owner>/<project>/<model>/predict: 20 requests a
 * minute — tests only). The key is ULTRALYTICS_API_KEY.
 */
export const ULTRALYTICS_MODEL_PREFIX = 'ultralytics:';

export const isUltralyticsModel = (modelPath: string) =>
  modelPath.trim().toLowerCase().startsWith(ULTRALYTICS_MODEL_PREFIX);

export const ultralyticsUrlOf = (modelPath: string) =>
  modelPath.trim().slice(ULTRALYTICS_MODEL_PREFIX.length).trim();

/** One prediction of the Platform's detect answer: images[].results[]. */
interface PlatformResult {
  class: number;
  name?: string;
  confidence: number;
  box: { x1: number; y1: number; x2: number; y2: number };
}

/** The Platform's answer as detections in frame pixels (pixel boxes, as asked: normalize=false). */
export function detectionsOfPlatform(body: any, options: DetectOptions): Detection[] {
  const results: PlatformResult[] = body?.images?.[0]?.results ?? [];
  const keep = options.classes?.length ? new Set(options.classes) : null;
  return results
    .filter(r => r?.box && r.confidence >= options.conf && (!keep || keep.has(r.class)))
    .map(r => ({
      box: { x1: r.box.x1, y1: r.box.y1, x2: r.box.x2, y2: r.box.y2 },
      score: r.confidence,
      classId: r.class
    }));
}

export interface UltralyticsApiOptions {
  url: string;
  apiKey: string;
  /** Inference size sent as imgsz (default 640). */
  imgsz?: number;
  /** JPEG quality of the frames sent (default 80). */
  quality?: number;
  /** A frame that gets no answer in time counts as none (default 5 s). */
  timeoutMs?: number;
  /** For tests. */
  fetchImpl?: typeof fetch;
}

/**
 * The model on Ultralytics Platform (POST multipart `file`, `Authorization: Bearer <key>`): one
 * JPEG a frame. The camera worker drops frames while one is on its way, so a slow network lowers
 * the fps instead of falling behind. Rate limited (429): no detections until the Retry-After time,
 * then on again. Other errors are thrown (the camera shows them).
 */
export class UltralyticsApiDetector implements DetectorLike {
  private pausedUntil = 0;

  constructor(private readonly options: UltralyticsApiOptions) {
    if (!options.url) throw new Error('MODEL_PATH=ultralytics:<endpoint url>: the url is missing.');
    if (!options.apiKey)
      throw new Error(
        'ULTRALYTICS_API_KEY is not set (Ultralytics Platform → Settings → API keys).'
      );
  }

  async detect(frame: Frame, options: DetectOptions): Promise<Detection[]> {
    if (Date.now() < this.pausedUntil) return [];
    const { url, apiKey, imgsz = 640, quality = 80, timeoutMs = 5000 } = this.options;
    const fetchImpl = this.options.fetchImpl ?? fetch;

    const form = new FormData();
    form.append('file', new Blob([jpegOf(frame, quality)], { type: 'image/jpeg' }), 'frame.jpg');
    form.append('conf', String(Math.max(0.01, options.conf)));
    form.append('imgsz', String(imgsz));
    form.append('normalize', 'false');

    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (response.status === 429) {
      const wait = Number(response.headers.get('retry-after')) || 60;
      this.pausedUntil = Date.now() + wait * 1000;
      return [];
    }
    if (!response.ok) {
      const text = (await response.text().catch(() => '')).slice(0, 200);
      const why: Record<number, string> = {
        401: 'the API key was refused (ULTRALYTICS_API_KEY)',
        404: 'no such model or endpoint (MODEL_PATH)',
        413: 'the frame is too large'
      };
      throw new Error(`Ultralytics API ${response.status}: ${why[response.status] ?? text}`);
    }
    return detectionsOfPlatform(await response.json(), options);
  }
}

/** An rgb24 frame as a JPEG (jpeg-js wants RGBA). */
function jpegOf(frame: Frame, quality: number): Uint8Array {
  const rgba = new Uint8Array(frame.width * frame.height * 4);
  for (let i = 0, j = 0; i < frame.data.length; i += 3, j += 4) {
    rgba[j] = frame.data[i];
    rgba[j + 1] = frame.data[i + 1];
    rgba[j + 2] = frame.data[i + 2];
    rgba[j + 3] = 255;
  }
  return new Uint8Array(
    encodeJpeg({ data: rgba, width: frame.width, height: frame.height }, quality).data
  );
}
