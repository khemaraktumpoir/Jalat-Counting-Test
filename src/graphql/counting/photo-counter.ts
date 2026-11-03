/**
 * Counting one photo, without Nest: the model (the parcel model, else the cameras' detector), the
 * boxes tidied, each box's look (the look-alike model) and the photo's fingerprint. PhotoCountService
 * runs it in a worker thread of its own (photo.worker.ts) so a photo never holds up the API, or here
 * in the process when there is no built worker (tests, ts-node). Saving the record stays in the
 * service. Everything it needs comes in PhotoCounterSettings, so a worker can make the same counter.
 */
import { basename } from 'path';

import { C } from '@common';
import {
  ColorDetector,
  DEMO_MODEL,
  Detection,
  Detector,
  DetectorLike,
  Frame,
  isUltralyticsModel,
  SkipReason,
  sortParcels,
  UltralyticsApiDetector,
  ultralyticsUrlOf
} from '@lib/counting';
import {
  Embedder,
  loadEmbedder,
  loadOnnxModel,
  photoFingerprint,
  photoFrame
} from '@lib/inference';

export interface PhotoCountOptions {
  /** Minimum score (0–1); the service's DEFAULT_CONF when left out. */
  conf?: number | null;
  /** Class ids to count; all when empty. */
  classes?: number[] | null;
}

export interface PhotoCountResult {
  name: string;
  width: number;
  height: number;
  count: number;
  byClass: { label: string; count: number }[];
  /** Boxes as fractions of the photo (0–1), for the app to draw over its own copy. */
  boxes: PhotoBoxResult[];
  /** Boxes the model gave but that were not counted, and why (shown dashed in the app). */
  skipped: (PhotoBoxResult & { reason: SkipReason })[];
  /** The photo's fingerprint (photoFingerprint): the same scene twice has nearly the same one. */
  fingerprint: string | null;
  /**
   * One per box (same order): the parcel's look (512 numbers, length 1), when the look-alike model
   * is there; the app compares them across the batch's photos to suggest repeated parcels.
   */
  embeddings: number[][] | null;
  /** In a folder count: the earlier photo this one is a copy of (not counted again); else null. */
  copyOf: string | null;
  /** The saved record of this photo (when counted in a batch); null when not saved. */
  recordId: string | null;
  /** The earlier counted photo this one is a copy of, from the records (any batch, last PHOTO_DUP_DAYS). */
  copyOfRecord: PhotoRecordRef | null;
  error: string | null;
}

/** An earlier counted photo, as a copy points to it. */
export interface PhotoRecordRef {
  id: string;
  name: string;
  batchId: string;
  createdAt: Date;
}

export interface PhotoBoxResult {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  score: number;
}

/** What counts the objects in photos, and how. */
export interface PhotoModelInfo {
  /** parcels: the parcel model (every object is a parcel); cameras: the cameras' model and labels */
  kind: 'parcels' | 'cameras';
  /** The model file (or demo / Ultralytics endpoint) */
  name: string;
  /** The confidence used when the app sends none */
  conf: number;
}

interface PhotoModel extends PhotoModelInfo {
  detector: DetectorLike;
  labelOf: (classId: number) => string;
}

/** What a counter is made from (plain data: it crosses into a worker thread). */
export interface PhotoCounterSettings {
  /** The parcel model file, absolute; null: count with the cameras' detector. */
  parcelModelPath: string | null;
  /** The parcel model's confidence (PHOTO_CONF) and input size (PHOTO_MODEL_SIZE). */
  parcelConf: number;
  parcelInputSize: number;
  /** onnxruntime's execution provider and threads for the photo models. */
  provider: string;
  threads: number;
  /** The look-alike model file, absolute; null: off. */
  embedPath: string | null;
  /** The cameras' detector (MODEL_PATH), when there is no parcel model. */
  camera: {
    loaded: boolean;
    error: string | null;
    path: string;
    labels: Record<number, string>;
    apiKey: string | null;
    conf: number;
  };
}

/** No model to count with, or it could not be loaded (the API answers 503). */
export class PhotoModelError extends Error {
  readonly unavailable = true;
}

/** A counted photo as the app gets it, from the model's detections (not saved yet). */
export function photoResult(
  name: string,
  width: number,
  height: number,
  detections: Detection[],
  labelOf: (classId: number) => string,
  skipped: { detection: Detection; reason: SkipReason }[] = []
): PhotoCountResult {
  const byClass = new Map<string, number>();
  for (const d of detections)
    byClass.set(labelOf(d.classId), (byClass.get(labelOf(d.classId)) ?? 0) + 1);
  const round = (n: number) => Math.round(n * 10000) / 10000;
  const toBox = (d: Detection): PhotoBoxResult => ({
    x: round(d.box.x1 / width),
    y: round(d.box.y1 / height),
    w: round((d.box.x2 - d.box.x1) / width),
    h: round((d.box.y2 - d.box.y1) / height),
    label: labelOf(d.classId),
    score: round(d.score)
  });
  return {
    name: basename(name),
    width,
    height,
    count: detections.length,
    byClass: [...byClass]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    boxes: detections.map(toBox),
    skipped: skipped.map(s => ({ ...toBox(s.detection), reason: s.reason })),
    fingerprint: null,
    embeddings: null,
    copyOf: null,
    recordId: null,
    copyOfRecord: null,
    error: null
  };
}

export interface PhotoCounter {
  info(): Promise<PhotoModelInfo>;
  /** One photo (a JPEG), counted and described; not saved. */
  count(jpeg: Uint8Array, name: string, options?: PhotoCountOptions): Promise<PhotoCountResult>;
  /** Loads the models and runs each once (the first run is seconds slower); says how long it took. */
  warmUp(): Promise<string>;
}

export function createPhotoCounter(
  settings: PhotoCounterSettings,
  warn: (message: string) => void = () => undefined
): PhotoCounter {
  let model: Promise<PhotoModel> | null = null;
  let embedder: Promise<Embedder | null> | null = null;

  /** Made once: the parcel model when its file is there, else the cameras' detector with their labels. */
  function getModel(): Promise<PhotoModel> {
    model ??= (async (): Promise<PhotoModel> => {
      if (settings.parcelModelPath) {
        const onnx = await loadOnnxModel(
          settings.parcelModelPath,
          settings.provider,
          settings.threads
        );
        return {
          kind: 'parcels',
          name: basename(settings.parcelModelPath),
          conf: settings.parcelConf,
          detector: new Detector(onnx.infer, settings.parcelInputSize),
          labelOf: () => 'parcel'
        };
      }
      const camera = settings.camera;
      if (!camera.loaded)
        throw new PhotoModelError(
          `No model to count with: ${camera.error ?? 'MODEL_PATH is not loaded.'}`
        );
      const labelOf = (id: number) => camera.labels[id] ?? `class ${id}`;
      if (camera.path === DEMO_MODEL)
        return {
          kind: 'cameras',
          name: camera.path,
          conf: camera.conf,
          detector: new ColorDetector(),
          labelOf
        };
      if (isUltralyticsModel(camera.path))
        return {
          kind: 'cameras',
          name: 'ultralytics',
          conf: camera.conf,
          detector: new UltralyticsApiDetector({
            url: ultralyticsUrlOf(camera.path),
            apiKey: camera.apiKey ?? '',
            imgsz: C.MODEL_INPUT_SIZE
          }),
          labelOf
        };
      const onnx = await loadOnnxModel(camera.path, settings.provider, settings.threads);
      return {
        kind: 'cameras',
        name: basename(camera.path),
        conf: camera.conf,
        detector: new Detector(onnx.infer, C.MODEL_INPUT_SIZE),
        labelOf
      };
    })().catch(error => {
      model = null;
      if (error instanceof PhotoModelError) throw error;
      throw new PhotoModelError(`The model could not be loaded: ${error.message}`);
    });
    return model;
  }

  /**
   * Each box's look (rounded, to keep the answer small), when the look-alike model is there; null
   * without it or when it fails (the count itself never fails for it).
   */
  async function embeddingsOf(frame: Frame, detections: Detection[]): Promise<number[][] | null> {
    try {
      embedder ??= settings.embedPath
        ? loadEmbedder(settings.embedPath, settings.provider, settings.threads)
        : Promise.resolve(null);
      const loaded = await embedder;
      if (!loaded || !detections.length) return loaded ? [] : null;
      const vectors = await loaded.embed(
        frame,
        detections.map(d => d.box)
      );
      return vectors.map(v => Array.from(v, n => Math.round(n * 10000) / 10000));
    } catch (error: any) {
      warn(`Parcel look-alike model: ${error?.message ?? error}`);
      return null;
    }
  }

  return {
    async info() {
      const { kind, name, conf } = await getModel();
      return { kind, name, conf };
    },

    async count(jpeg, name, options = {}) {
      const loaded = await getModel();
      const frame = photoFrame(Buffer.from(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength));
      let detections = await loaded.detector.detect(frame, {
        conf: options.conf ?? loaded.conf,
        // The parcel model's classes are words for one thing: a parcel.
        classes: loaded.kind === 'parcels' ? [] : options.classes ?? []
      });
      let skipped: { detection: Detection; reason: SkipReason }[] = [];
      if (loaded.kind === 'parcels') {
        const sorted = sortParcels(detections, frame.width, frame.height);
        detections = sorted.kept;
        skipped = sorted.skipped;
      }
      return {
        ...photoResult(name, frame.width, frame.height, detections, loaded.labelOf, skipped),
        fingerprint: photoFingerprint(frame),
        embeddings: await embeddingsOf(frame, detections)
      };
    },

    async warmUp() {
      const t = Date.now();
      const loaded = await getModel();
      const frame: Frame = { data: new Uint8Array(64 * 64 * 3), width: 64, height: 64 };
      await loaded.detector.detect(frame, { conf: loaded.conf, classes: [] });
      await embeddingsOf(frame, [{ box: { x1: 8, y1: 8, x2: 56, y2: 56 }, score: 1, classId: 0 }]);
      return `Photo models ready (${loaded.name}) in ${Date.now() - t} ms`;
    }
  };
}
