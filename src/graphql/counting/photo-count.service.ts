import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  OnApplicationBootstrap,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, promises as fs, statSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';
import { CountingViewer } from 'src/repositories/counting-camera.repository';

import { CountingPhotoRecordEntity } from '@entities';
import { ConfigService } from '@lib/config';
import { COPY_BITS, fingerprintDistance, imageFileToJpeg, PHOTO_FILE } from '@lib/inference';
import { CountingPhotoRecordRepository } from '@repositories';

import * as I from './counting.input';
import { InferenceService } from './inference.service';
import {
  PhotoCounterSettings,
  PhotoCountOptions,
  PhotoCountResult,
  PhotoModelError,
  PhotoModelInfo,
  photoResult
} from './photo-counter';
import { PhotoQueue, PhotoQueueFullError } from './photo-queue';
import { createPhotoRunner, PhotoRunner } from './photo-runner';

export type {
  PhotoBoxResult,
  PhotoCountOptions,
  PhotoCountResult,
  PhotoModelInfo,
  PhotoRecordRef
} from './photo-counter';

/** Save a counted photo to the records: whose batch, and its place in it. */
export interface PhotoSave {
  viewer: CountingViewer;
  batchId: string;
  seq: number;
  /** The batch's name, if the app gave one. */
  note?: string | null;
}

export type { SkipReason } from '@lib/counting';

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

/** The parcel look-alike model looked for when PHOTO_EMBED_PATH is not set. */
export const DEFAULT_EMBED_MODEL = 'models/parcel-embed.onnx';

/** The parcel model looked for when PHOTO_MODEL_PATH is not set (in the service's folder). */
export const DEFAULT_PHOTO_MODEL = 'models/parcel-world-m.onnx';
/**
 * The models looked for in turn when PHOTO_MODEL_PATH is not set: YOLO-World medium (the default
 * since 23 Oct 2026: the same counts as large on the pickup photos, 1.75× faster on a CPU, 112 MB),
 * then large (186 MB), on a server that still has only that one.
 */
const DEFAULT_PHOTO_MODELS = [DEFAULT_PHOTO_MODEL, 'models/parcel-world-l.onnx'];

/**
 * The parcel model's confidence when PHOTO_CONF is not set. Low on purpose: in a real pile a parcel
 * half hidden by another, or small on a big one, scores 0.01–0.05; sortParcels drops the floor,
 * groups and pieces this lets in (27 Oct 2026: photos/real-2026-10-27 and pickup-2026-10-21 off by
 * 3 parcels in all with 0.01, 14 with the earlier 0.06 and in-model NMS at IoU 0.4).
 */
export const DEFAULT_PHOTO_CONF = 0.01;

export { GROUP_PART, SAME_SIZE, WEAK_PARCEL, sortParcels, tidyParcels } from '@lib/counting';

/** Folders a folder count may read when PHOTO_ROOTS is not set (in the service's folder). */
const DEFAULT_ROOTS = 'photos,test-videos';
export const PHOTO_FOLDER_MAX = 500;

/**
 * Counting the objects in still photos. By default the parcel model (PHOTO_MODEL_PATH, else
 * models/parcel-world-m.onnx: YOLO-World told "parcel, mailer bag, shopping bag, gift bag, box"),
 * which finds parcels of any shape in a driver's pickup photos with no training; its boxes are
 * tidied (tidyParcels) and all called "parcel". Without that file, the cameras' detector
 * (MODEL_PATH: the ONNX model, the Ultralytics endpoint, or the demo colour detector), by label. No tracking and no line: every object seen counts once. The
 * photos come from the warehouse app (one JPEG a request, made small on the phone) or from a folder
 * on this machine, inside PHOTO_ROOTS. One photo at a time, so a batch never starves the cameras,
 * each user in turn and refused with 429 when too many wait (PhotoQueue), counted in a worker thread
 * of its own (photo.worker.ts) so the API stays responsive meanwhile.
 */
@Injectable()
export class PhotoCountService implements OnApplicationBootstrap {
  private readonly logger = new Logger('PhotoCount');
  private runner: PhotoRunner | null = null;
  private readonly queue: PhotoQueue;

  constructor(
    private readonly inference: InferenceService,
    private readonly config: ConfigService,
    /** Optional so the photo counting core is tested without a database. */
    private readonly records?: CountingPhotoRecordRepository
  ) {
    this.queue = new PhotoQueue(
      this.config.env.PHOTO_QUEUE_MAX ?? 60,
      this.config.env.PHOTO_QUEUE_PER_USER ?? 20
    );
  }

  /**
   * Loads the photo models and runs each once in the background when the service starts: the first
   * run of an ONNX model is several seconds slower (loading, graph optimisation), and the first photo
   * of the day should not pay for it.
   */
  onApplicationBootstrap(): void {
    setTimeout(() => void this.warmUp(), 0);
  }

  private warmUp(): Promise<void> {
    return this.queue
      .add('warm-up', () => this.run(r => r.warmUp()))
      .then(
        ready => this.logger.log(ready),
        error => this.logger.warn(`Photo models not warmed up: ${error?.message ?? error}`)
      );
  }

  /** What the photo counter is made from (read when it starts, again after a model error). */
  private settings(): PhotoCounterSettings {
    const env = this.config.env;
    // onnxruntime's execution provider: the cameras' provider is "demo" or "ultralytics" when
    // they run no ONNX model, so those mean the configured one (cpu unless MODEL_PROVIDER says).
    const cameraProvider = this.inference.provider;
    const provider = ['demo', 'ultralytics'].includes(cameraProvider)
      ? env.MODEL_PROVIDER || 'cpu'
      : cameraProvider;
    return {
      parcelModelPath: this.photoModelPath(),
      parcelConf: env.PHOTO_CONF ?? DEFAULT_PHOTO_CONF,
      parcelInputSize: env.PHOTO_MODEL_SIZE ?? 1280,
      provider,
      threads: this.inference.threads,
      embedPath:
        env.PHOTO_EMBED_PATH === 'off'
          ? null
          : resolve(process.cwd(), env.PHOTO_EMBED_PATH || DEFAULT_EMBED_MODEL),
      camera: {
        loaded: this.inference.modelLoaded,
        error: this.inference.modelError ?? null,
        path: this.inference.modelPath,
        labels: this.inference.labels,
        apiKey: this.inference.apiKey ?? null,
        conf: env.DEFAULT_CONF ?? 0.4
      }
    };
  }

  /**
   * A job on the photo counter (made on first use). A model error starts a new one next time, with
   * fresh settings (the cameras' model may have loaded since); it is said as 503.
   */
  private async run<T>(job: (runner: PhotoRunner) => Promise<T>): Promise<T> {
    this.runner ??= createPhotoRunner(
      this.settings(),
      message => this.logger.warn(message),
      this.config.env.PHOTO_WORKER === 'off' ? false : undefined
    );
    try {
      return await job(this.runner);
    } catch (error: any) {
      if (error instanceof PhotoModelError) {
        this.runner?.close();
        this.runner = null;
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
  }

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
  modelInfo(): Promise<PhotoModelInfo> {
    return this.run(r => r.info());
  }

  /** One photo (a JPEG): what the model sees in it, counted by label. */
  async countJpeg(
    jpeg: Buffer,
    name: string,
    options: PhotoCountOptions = {},
    save?: PhotoSave,
    /** Whose turn it is in the queue: the viewer's id, else the batch's. */
    user = save?.viewer.id ?? 'anonymous'
  ): Promise<PhotoCountResult> {
    try {
      return await this.queue.add(user, async () => {
        const result = await this.run(r => r.count(jpeg, name, options));
        // Saved in the same turn, so two photos of one batch never miss each other.
        if (save && this.records) Object.assign(result, await this.saveRecord(result, save));
        return result;
      });
    } catch (error) {
      if (error instanceof PhotoQueueFullError)
        throw new HttpException(
          { statusCode: 429, message: error.message, retryAfter: error.retryAfterSeconds },
          HttpStatus.TOO_MANY_REQUESTS
        );
      throw error;
    }
  }

  /**
   * Saves a counted photo and finds the earlier one it is a copy of: among the records the viewer
   * sees from the last PHOTO_DUP_DAYS days (0 = this batch only), the oldest within COPY_BITS. In
   * one batch the photo picked first is the original, whichever finished first: a later photo of
   * the batch already saved that matches this one becomes its copy.
   */
  private async saveRecord(
    result: PhotoCountResult,
    { viewer, batchId, seq, note }: PhotoSave
  ): Promise<Pick<PhotoCountResult, 'recordId' | 'copyOfRecord'>> {
    const records = this.records!;
    // The same photo counted again (Retry, or an answer lost on the way): it replaces its record.
    const again = await records.findOne({ where: { batchId, seq, ownerId: viewer.id } });
    if (again) {
      await records.update({ copyOfId: again.id }, { copyOfId: null });
      await records.update({ repeatsOfId: again.id }, { repeatsOfId: null, repeats: 0 });
      await records.delete(again.id);
    }
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
        batchNote: note?.trim() || null,
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
  batches(viewer: CountingViewer, from: Date, to: Date, search?: string) {
    return this.records ? this.records.$batches(viewer, from, to, search) : Promise.resolve([]);
  }

  /** Names a batch (each of its photos); false when the viewer has no such batch. */
  async nameBatch(viewer: CountingViewer, input: I.NamePhotoBatchInput): Promise<boolean> {
    if (!this.records) throw new ServiceUnavailableException('Photo records are not kept here.');
    const named = await this.records.$nameBatch(viewer, input.batchId, input.note?.trim() || null);
    if (!named) throw new NotFoundException('No such batch of counted photos.');
    return true;
  }

  /** Deletes a batch counted by mistake: it leaves every total. */
  async deleteBatch(viewer: CountingViewer, batchId: string): Promise<boolean> {
    if (!this.records) throw new ServiceUnavailableException('Photo records are not kept here.');
    const deleted = await this.records.$deleteBatch(viewer, batchId);
    if (!deleted) throw new NotFoundException('No such batch of counted photos.');
    return true;
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
          ...new Set(rows.flatMap(r => [r.copyOfId, r.repeatsOfId]).filter(Boolean))
        ] as string[])
      ).map(o => [o.id, o])
    );
    const refOf = (o?: CountingPhotoRecordEntity) =>
      o ? { id: o.id, name: o.name, batchId: o.batchId, createdAt: o.createdAt } : null;
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
        copyOf: refOf(o),
        repeats: r.repeats ?? 0,
        repeatsOf: refOf(r.repeatsOfId ? originals.get(r.repeatsOfId) : undefined),
        added: r.added ?? 0,
        removed: r.removed ?? 0
      };
    });
  }

  /**
   * A counted photo fixed by hand in Count photos: parcels the model missed (added) and its boxes
   * that are not parcels (removed); the batch's parcels follow.
   */
  async correctCount(viewer: CountingViewer, input: I.CorrectPhotoCountInput) {
    if (!this.records) throw new ServiceUnavailableException('Photo records are not kept here.');
    const record = await this.records.$visible(viewer, input.recordId);
    if (!record) throw new NotFoundException('No such counted photo.');
    if (input.removed > record.count)
      throw new BadRequestException(
        `The model counted ${record.count} in this photo: at most ${record.count} can be taken off.`
      );
    await this.records.update(record.id, { added: input.added, removed: input.removed });
    const rows = await this.photoRecords(viewer, {
      batchId: record.batchId,
      from: record.createdAt,
      to: record.createdAt,
      limit: 1000
    });
    return rows.find(r => r.id === record.id);
  }

  /**
   * Marks how many parcels of a counted photo an earlier photo of its batch already shows (one
   * parcel photographed twice), so the batch counts them once; 0 clears the mark.
   */
  async markRepeats(viewer: CountingViewer, input: I.MarkPhotoRepeatsInput) {
    if (!this.records) throw new ServiceUnavailableException('Photo records are not kept here.');
    const record = await this.records.$visible(viewer, input.recordId);
    if (!record) throw new NotFoundException('No such counted photo.');
    if (record.copyOfId)
      throw new BadRequestException(
        'This photo is a copy of another one: it is not counted at all.'
      );
    if (input.repeats > record.count)
      throw new BadRequestException(
        `This photo has ${record.count} parcel${record.count === 1 ? '' : 's'}: at most ${
          record.count
        } can be repeats.`
      );
    let ofId: string | null = null;
    if (input.repeats > 0) {
      if (!input.ofRecordId)
        throw new BadRequestException('Say which earlier photo shows these parcels (ofRecordId).');
      const of = await this.records.$visible(viewer, input.ofRecordId);
      if (!of || of.batchId !== record.batchId || of.id === record.id || of.copyOfId)
        throw new BadRequestException('Pick another counted photo of the same batch.');
      ofId = of.id;
    }
    await this.records.update(record.id, { repeats: input.repeats, repeatsOfId: ofId });
    const rows = await this.photoRecords(viewer, {
      batchId: record.batchId,
      from: record.createdAt,
      to: record.createdAt,
      limit: 1000
    });
    return rows.find(r => r.id === record.id);
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
          await this.countJpeg(
            jpeg,
            name,
            options,
            viewer ? { viewer, batchId, seq } : undefined,
            viewer?.id ?? `folder:${batchId}`
          )
        );
      } catch (error: any) {
        if (error instanceof ServiceUnavailableException) throw error;
        photos.push({
          ...photoResult(name, 0, 0, [], () => ''),
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

  /** The parcel model file, if there is one: PHOTO_MODEL_PATH, else parcel-world-m (or -l) in models/. */
  photoModelPath(): string | null {
    const configured = this.config.env.PHOTO_MODEL_PATH;
    const paths = (configured ? [configured] : DEFAULT_PHOTO_MODELS).map(p =>
      resolve(process.cwd(), p)
    );
    return paths.find(p => existsSync(p)) ?? null;
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
