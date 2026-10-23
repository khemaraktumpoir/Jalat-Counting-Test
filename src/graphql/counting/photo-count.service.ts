import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, promises as fs, statSync } from 'fs';
import { basename, isAbsolute, relative, resolve } from 'path';
import { CountingViewer } from 'src/repositories/counting-camera.repository';

import { C } from '@common';
import { CountingPhotoRecordEntity } from '@entities';
import { ConfigService } from '@lib/config';
import {
  ColorDetector,
  DEMO_MODEL,
  Detection,
  Detector,
  DetectorLike,
  isUltralyticsModel,
  UltralyticsApiDetector,
  ultralyticsUrlOf
} from '@lib/counting';
import {
  COPY_BITS,
  fingerprintDistance,
  imageFileToJpeg,
  loadOnnxModel,
  PHOTO_FILE,
  photoFingerprint,
  photoFrame
} from '@lib/inference';
import { CountingPhotoRecordRepository } from '@repositories';

import { InferenceService } from './inference.service';

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

/** Save a counted photo to the records: whose batch, and its place in it. */
export interface PhotoSave {
  viewer: CountingViewer;
  batchId: string;
  seq: number;
}

export interface PhotoBoxResult {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  score: number;
}

/** duplicate: the same parcel boxed twice; floor: a box over most of the photo; weak: a weak guess lying on a surer parcel */
export type SkipReason = 'duplicate' | 'floor' | 'weak';

export interface PhotoFolderResult {
  folder: string;
  photos: PhotoCountResult[];
  total: number;
  counted: number;
  failed: number;
  byClass: { label: string; count: number }[];
  /** More photos in the folder than the limit: only the first ones (by name) were counted. */
  more: boolean;
  /** Photos that are copies of an earlier one (copyOf), left out of the total. */
  copies: number;
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

/** The parcel model looked for when PHOTO_MODEL_PATH is not set (in the service's folder). */
export const DEFAULT_PHOTO_MODEL = 'models/parcel-world-l.onnx';

/** Below this score a box is a weak guess: kept only when it isn't lying on a surer parcel. */
export const WEAK_PARCEL = 0.1;

/**
 * The parcel model's boxes, tidied: a box over most of the photo is the floor, and a box mostly
 * inside another (or around it) is the same parcel seen twice; the more certain one stays. A weak
 * guess (under WEAK_PARCEL) lying for the most part on a surer parcel is the floor or a corner of
 * it; a weak guess on its own (a parcel wrapped in paper, which the model finds hard) stays.
 */
export function tidyParcels(detections: Detection[], width: number, height: number): Detection[] {
  return sortParcels(detections, width, height).kept;
}

/** tidyParcels, with the boxes it leaves out and why. */
export function sortParcels(
  detections: Detection[],
  width: number,
  height: number
): { kept: Detection[]; skipped: { detection: Detection; reason: SkipReason }[] } {
  const area = (b: Detection['box']) => Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const inside = (a: Detection['box'], b: Detection['box']) => {
    const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
    const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
    return area(a) ? (w * h) / area(a) : 0;
  };
  const kept: Detection[] = [];
  const skipped: { detection: Detection; reason: SkipReason }[] = [];
  for (const d of [...detections].sort((a, b) => b.score - a.score)) {
    if (area(d.box) > 0.45 * width * height) skipped.push({ detection: d, reason: 'floor' });
    else if (kept.some(k => inside(d.box, k.box) > 0.6 || inside(k.box, d.box) > 0.6))
      skipped.push({ detection: d, reason: 'duplicate' });
    else if (d.score < WEAK_PARCEL && kept.some(k => inside(d.box, k.box) > 0.4))
      skipped.push({ detection: d, reason: 'weak' });
    else kept.push(d);
  }
  return { kept, skipped };
}

/** Folders a folder count may read when PHOTO_ROOTS is not set (in the service's folder). */
const DEFAULT_ROOTS = 'photos,samples';
export const PHOTO_FOLDER_MAX = 500;

/**
 * Counting the objects in still photos. By default the parcel model (PHOTO_MODEL_PATH, else
 * models/parcel-world-l.onnx: YOLO-World told "parcel, mailer bag, shopping bag, gift bag, box"),
 * which finds parcels of any shape in a driver's pickup photos with no training; its boxes are
 * tidied (tidyParcels) and all called "parcel". Without that file, the cameras' detector
 * (MODEL_PATH: the ONNX model, the Ultralytics endpoint, or the demo colour detector), by label. No tracking and no line: every object seen counts once. The
 * photos come from the warehouse app (one JPEG a request, made small on the phone) or from a folder
 * on this machine, inside PHOTO_ROOTS. One photo at a time, so a batch never starves the cameras.
 */
@Injectable()
export class PhotoCountService {
  private model: Promise<PhotoModel> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly inference: InferenceService,
    private readonly config: ConfigService,
    /** Optional so the photo counting core is tested without a database. */
    private readonly records?: CountingPhotoRecordRepository
  ) {}

  /** The folders a folder count may read, as absolute paths. */
  roots(): string[] {
    return (this.config.env.PHOTO_ROOTS || DEFAULT_ROOTS)
      .split(',')
      .map(root => root.trim())
      .filter(Boolean)
      .map(root => resolve(process.cwd(), root));
  }

  /** The roots as the app shows them: relative to the service's folder when inside it. */
  rootNames(): string[] {
    return this.roots().map(root => {
      const rel = relative(process.cwd(), root);
      return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.replace(/\\/g, '/') : root;
    });
  }

  /** A folder path (relative to the service's folder, or absolute) inside one of the roots. */
  resolveFolder(path: string): string {
    const wanted = resolve(process.cwd(), path.trim());
    const inside = this.roots().some(root => {
      const rel = relative(root, wanted);
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
    });
    if (!inside)
      throw new BadRequestException(
        `Only these folders can be counted: ${this.rootNames().join(
          ', '
        )} (and the folders inside them).`
      );
    if (!existsSync(wanted) || !statSync(wanted).isDirectory())
      throw new NotFoundException(`No folder "${path.trim()}" on the counting service.`);
    return wanted;
  }

  /** What counts the photos (the app shows it, and hides "what to count" for the parcel model). */
  async modelInfo(): Promise<PhotoModelInfo> {
    const { kind, name, conf } = await this.getModel();
    return { kind, name, conf };
  }

  /** One photo (a JPEG): what the model sees in it, counted by label. */
  countJpeg(
    jpeg: Buffer,
    name: string,
    options: PhotoCountOptions = {},
    save?: PhotoSave
  ): Promise<PhotoCountResult> {
    return this.oneAtATime(async () => {
      const model = await this.getModel();
      const frame = photoFrame(jpeg);
      let detections = await model.detector.detect(frame, {
        conf: options.conf ?? model.conf,
        // The parcel model's classes are words for one thing: a parcel.
        classes: model.kind === 'parcels' ? [] : options.classes ?? []
      });
      let skipped: { detection: Detection; reason: SkipReason }[] = [];
      if (model.kind === 'parcels') {
        const sorted = sortParcels(detections, frame.width, frame.height);
        detections = sorted.kept;
        skipped = sorted.skipped;
      }
      const result: PhotoCountResult = {
        ...this.result(name, frame.width, frame.height, detections, model.labelOf, skipped),
        fingerprint: photoFingerprint(frame)
      };
      // Saved in the same turn, so two photos of one batch never miss each other.
      if (save && this.records) Object.assign(result, await this.saveRecord(result, save));
      return result;
    });
  }

  /**
   * Saves a counted photo and finds the earlier one it is a copy of: among the records the viewer
   * sees from the last PHOTO_DUP_DAYS days (0 = this batch only), the oldest within COPY_BITS. In
   * one batch the photo picked first is the original, whichever finished first: a later photo of
   * the batch already saved that matches this one becomes its copy.
   */
  private async saveRecord(
    result: PhotoCountResult,
    { viewer, batchId, seq }: PhotoSave
  ): Promise<Pick<PhotoCountResult, 'recordId' | 'copyOfRecord'>> {
    const records = this.records!;
    const days = this.config.env.PHOTO_DUP_DAYS ?? 7;
    const since = new Date(Date.now() - Math.max(days, 1) * 86_400_000);
    const earlier = (await records.$recentFingerprints(viewer, since)).filter(
      r => days > 0 || r.batchId === batchId
    );
    const near = (r: CountingPhotoRecordEntity) =>
      fingerprintDistance(r.fingerprint, result.fingerprint) <= COPY_BITS;
    const later = (r: CountingPhotoRecordEntity) => r.batchId === batchId && r.seq > seq;
    const original = earlier.find(r => near(r) && !r.copyOfId && !later(r)) ?? null;
    const saved = await records.save(
      records.create({
        batchId,
        seq,
        name: result.name,
        fingerprint: result.fingerprint,
        count: result.count,
        byClass: result.byClass,
        copyOfId: original?.id ?? null,
        ownerId: viewer.id,
        ownerType: viewer.userType ?? null
      })
    );
    const laterCopies = earlier.filter(r => later(r) && near(r) && !r.copyOfId).map(r => r.id);
    if (laterCopies.length)
      await records.update(laterCopies, { copyOfId: original?.id ?? saved.id });
    return {
      recordId: saved.id,
      copyOfRecord: original
        ? {
            id: original.id,
            name: original.name,
            batchId: original.batchId,
            createdAt: original.createdAt
          }
        : null
    };
  }

  /** The viewer's batches of counted photos between from and to, newest first. */
  batches(viewer: CountingViewer, from: Date, to: Date) {
    return this.records ? this.records.$batches(viewer, from, to) : Promise.resolve([]);
  }

  /**
   * Counted photos: one batch's in the order picked, or (copiesOnly) every copy between from and
   * to, newest first; each with the earlier photo it repeats.
   */
  async photoRecords(
    viewer: CountingViewer,
    filter: { batchId?: string; copiesOnly?: boolean; from: Date; to: Date; limit: number }
  ) {
    if (!this.records) return [];
    const rows = await this.records.$records(viewer, filter);
    const originals = new Map(
      (
        await this.records.$byIds([
          ...new Set(rows.map(r => r.copyOfId).filter(Boolean))
        ] as string[])
      ).map(o => [o.id, o])
    );
    return rows.map(r => {
      const o = r.copyOfId ? originals.get(r.copyOfId) : undefined;
      return {
        id: r.id,
        batchId: r.batchId,
        seq: r.seq,
        name: r.name,
        count: r.count,
        byClass: r.byClass ?? [],
        createdAt: r.createdAt,
        copyOf: o ? { id: o.id, name: o.name, batchId: o.batchId, createdAt: o.createdAt } : null
      };
    });
  }

  /** Every photo in a folder (not its sub-folders), by name, up to `limit`. */
  async countFolder(
    path: string,
    options: PhotoCountOptions = {},
    limit = 200,
    viewer?: CountingViewer
  ): Promise<PhotoFolderResult> {
    // One batch per folder count, saved to the records when we know who counts.
    const batchId = randomUUID();
    const folder = this.resolveFolder(path);
    const max = Math.min(Math.max(1, limit), PHOTO_FOLDER_MAX);
    const names = (await fs.readdir(folder))
      .filter(name => PHOTO_FILE.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const photos: PhotoCountResult[] = [];
    for (const [seq, name] of names.slice(0, max).entries()) {
      const file = resolve(folder, name);
      try {
        const jpeg = /\.jpe?g$/i.test(name)
          ? await fs.readFile(file)
          : await imageFileToJpeg(file, this.inference.ffmpegPath);
        photos.push(
          await this.countJpeg(jpeg, name, options, viewer ? { viewer, batchId, seq } : undefined)
        );
      } catch (error: any) {
        if (error instanceof ServiceUnavailableException) throw error;
        photos.push({
          ...this.result(name, 0, 0, [], () => ''),
          error: error?.message ?? String(error)
        });
      }
    }
    markCopies(photos);
    // A copy of a photo counted before, in an earlier batch.
    for (const p of photos) if (!p.copyOf && p.copyOfRecord) p.copyOf = p.copyOfRecord.name;
    const counted = photos.filter(p => !p.error && !p.copyOf);
    return {
      folder: path.trim(),
      photos,
      total: counted.reduce((sum, p) => sum + p.count, 0),
      counted: counted.length,
      failed: photos.filter(p => p.error).length,
      byClass: sumByClass(counted),
      more: names.length > max,
      copies: photos.filter(p => p.copyOf).length
    };
  }

  private result(
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
    return {
      name: basename(name),
      width,
      height,
      count: detections.length,
      byClass: [...byClass]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
      boxes: detections.map(d => toBox(d)),
      skipped: skipped.map(s => ({ ...toBox(s.detection), reason: s.reason })),
      fingerprint: null,
      copyOf: null,
      recordId: null,
      copyOfRecord: null,
      error: null
    };
    function toBox(d: Detection): PhotoBoxResult {
      return {
        x: round(d.box.x1 / width),
        y: round(d.box.y1 / height),
        w: round((d.box.x2 - d.box.x1) / width),
        h: round((d.box.y2 - d.box.y1) / height),
        label: labelOf(d.classId),
        score: round(d.score)
      };
    }
  }

  /** The parcel model file, if there is one: PHOTO_MODEL_PATH, else models/parcel-world-l.onnx. */
  photoModelPath(): string | null {
    const configured = this.config.env.PHOTO_MODEL_PATH;
    const path = resolve(process.cwd(), configured || DEFAULT_PHOTO_MODEL);
    return existsSync(path) ? path : null;
  }

  /**
   * Made once for this process: the parcel model when its file is there, else the cameras'
   * detector (MODEL_PATH) with their labels.
   */
  private getModel(): Promise<PhotoModel> {
    this.model ??= (async (): Promise<PhotoModel> => {
      const parcelPath = this.photoModelPath();
      if (parcelPath) {
        // onnxruntime's execution provider: the cameras' provider is "demo" or "ultralytics" when
        // they run no ONNX model, so those mean the configured one (cpu unless MODEL_PROVIDER says).
        const cameraProvider = this.inference.provider;
        const provider = ['demo', 'ultralytics'].includes(cameraProvider)
          ? this.config.env.MODEL_PROVIDER || 'cpu'
          : cameraProvider;
        const model = await loadOnnxModel(parcelPath, provider, this.inference.threads);
        return {
          kind: 'parcels',
          name: basename(parcelPath),
          conf: this.config.env.PHOTO_CONF ?? 0.06,
          detector: new Detector(model.infer, this.config.env.PHOTO_MODEL_SIZE ?? 1280),
          labelOf: () => 'parcel'
        };
      }
      if (!this.inference.modelLoaded)
        throw new ServiceUnavailableException(
          `No model to count with: ${this.inference.modelError ?? 'MODEL_PATH is not loaded.'}`
        );
      const path = this.inference.modelPath;
      const labelOf = (id: number) => this.inference.labels[id] ?? `class ${id}`;
      const conf = this.config.env.DEFAULT_CONF ?? 0.4;
      if (path === DEMO_MODEL)
        return { kind: 'cameras', name: path, conf, detector: new ColorDetector(), labelOf };
      if (isUltralyticsModel(path))
        return {
          kind: 'cameras',
          name: 'ultralytics',
          conf,
          detector: new UltralyticsApiDetector({
            url: ultralyticsUrlOf(path),
            apiKey: this.inference.apiKey ?? '',
            imgsz: C.MODEL_INPUT_SIZE
          }),
          labelOf
        };
      const model = await loadOnnxModel(path, this.inference.provider, this.inference.threads);
      return {
        kind: 'cameras',
        name: basename(path),
        conf,
        detector: new Detector(model.infer, C.MODEL_INPUT_SIZE),
        labelOf
      };
    })().catch(error => {
      this.model = null;
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(`The model could not be loaded: ${error.message}`);
    });
    return this.model;
  }

  private oneAtATime<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

/** Labels added up over photos, the most first. */
export function sumByClass(photos: Pick<PhotoCountResult, 'byClass'>[]) {
  const totals = new Map<string, number>();
  for (const photo of photos)
    for (const { label, count } of photo.byClass)
      totals.set(label, (totals.get(label) ?? 0) + count);
  return [...totals].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

/**
 * Marks each photo that shows the same scene as an earlier counted one (fingerprints within
 * COPY_BITS) with copyOf = that photo's name, so its parcels are not counted twice.
 */
export function markCopies(
  photos: Pick<PhotoCountResult, 'name' | 'fingerprint' | 'copyOf' | 'error'>[]
): void {
  const originals: Pick<PhotoCountResult, 'name' | 'fingerprint'>[] = [];
  for (const photo of photos) {
    if (photo.error || !photo.fingerprint) continue;
    const original = originals.find(
      o => fingerprintDistance(o.fingerprint, photo.fingerprint) <= COPY_BITS
    );
    if (original) photo.copyOf = original.name;
    else originals.push(photo);
  }
}
