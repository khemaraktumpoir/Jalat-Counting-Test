import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { join } from 'path';
import { mergeByClass } from 'src/repositories/counting-snapshot.repository';
import { Worker } from 'worker_threads';

import { C, E } from '@common';
import { CountingCameraEntity, CountingRegionEntity } from '@entities';
import { Counts, RegionShape } from '@lib/counting';
import { grabJpeg, isManualSource, isPhoneSource } from '@lib/inference';
import { MQTTService } from '@lib/mqtt';
import {
  CountingCameraRepository,
  CountingRegionRepository,
  CountingSnapshotRepository
} from '@repositories';

import { CameraWorkerData, FromWorker, ToWorker } from './camera-worker.protocol';
import { InferenceService } from './inference.service';

export interface CameraRuntime {
  status: E.CameraRunStatusEnum;
  fps: number;
  error: string | null;
  /** Since the camera's last reset: saved snapshots + what this run counted. */
  counts: Counts;
  updatedAt: Date | null;
}

interface Running {
  worker: Worker;
  status: E.CameraRunStatusEnum;
  fps: number;
  error: string | null;
  /** Saved since the last reset when this run started (or 0 after a reset). */
  base: Counts;
  /** Counted by this run (the worker's own counts). */
  live: Counts;
  /** `live` as last saved to CountingSnapshots. */
  saved: Counts;
  updatedAt: Date | null;
  snapshots: Map<number, (jpeg: Buffer | null, error?: string) => void>;
  previewListeners: Set<(jpeg: Buffer) => void>;
}

const zero = (): Counts => ({ in: 0, out: 0, byClass: {} });
const sum = (...parts: Counts[]): Counts => {
  const total = zero();
  for (const p of parts) {
    total.in += p.in;
    total.out += p.out;
    mergeByClass(total.byClass, p.byClass);
  }
  return total;
};
const minus = (a: Counts, b: Counts): Counts => {
  const byClass: Counts['byClass'] = {};
  for (const [label, v] of Object.entries(a.byClass)) {
    const prev = b.byClass[label] ?? { in: 0, out: 0 };
    if (v.in - prev.in || v.out - prev.out)
      byClass[label] = { in: v.in - prev.in, out: v.out - prev.out };
  }
  return { in: a.in - b.in, out: a.out - b.out, byClass };
};

export const regionShapeOf = (region: CountingRegionEntity | null): RegionShape | null =>
  region ? { type: region.type as RegionShape['type'], points: region.points } : null;

/**
 * Starts, stops and watches the camera workers (one worker thread each), keeps their counts, saves
 * them, and broadcasts them on MQTT (C.mqttCameraCountTopic / mqttCameraStatusTopic) when they change.
 */
@Injectable()
export class CameraManagerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('CameraManager');
  private readonly running = new Map<string, Running>();
  private nextRequestId = 1;

  constructor(
    private readonly cameraRepo: CountingCameraRepository,
    private readonly regionRepo: CountingRegionRepository,
    private readonly snapshotRepo: CountingSnapshotRepository,
    private readonly inference: InferenceService,
    private readonly mqtt: MQTTService
  ) {}

  /** Enabled cameras start with the service. */
  async onApplicationBootstrap(): Promise<void> {
    const cameras = await this.cameraRepo.find({ where: { enabled: true } });
    for (const camera of cameras) {
      await this.start(camera).catch(error =>
        this.logger.error(`${camera.name}: ${error.message}`)
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.running.keys()].map(id => this.stop(id)));
  }

  isRunning(cameraId: string): boolean {
    return this.running.has(cameraId);
  }

  async start(camera: CountingCameraEntity): Promise<void> {
    // A manual counter has nothing to run: its counts come from addManualCount.
    if (this.running.has(camera.id) || isManualSource(camera.sourceUrl)) return;
    const region = await this.regionRepo.findOne({ where: { cameraId: camera.id } });
    const data: CameraWorkerData = {
      cameraId: camera.id,
      sourceUrl: camera.sourceUrl,
      fps: camera.fps,
      width: camera.width,
      height: camera.height,
      loop: camera.loop,
      conf: camera.confThreshold,
      classes: camera.classes ?? [],
      region: regionShapeOf(region),
      labels: this.inference.labels,
      modelPath: this.inference.modelPath,
      provider: this.inference.provider,
      threads: this.inference.threads,
      apiKey: this.inference.apiKey,
      ffmpegPath: this.inference.ffmpegPath,
      reconnectMaxMs: C.CAMERA_RECONNECT_MAX_MS
    };
    const base = await this.snapshotRepo.$totalSince(camera.id, camera.countsResetAt);
    const worker = new Worker(join(__dirname, 'camera.worker.js'), { workerData: data });
    const run: Running = {
      worker,
      status: E.CameraRunStatusEnum.STARTING,
      fps: 0,
      error: null,
      base,
      live: zero(),
      saved: zero(),
      updatedAt: null,
      snapshots: new Map(),
      previewListeners: new Set()
    };
    this.running.set(camera.id, run);
    worker.on('message', (message: FromWorker) => this.onMessage(camera.id, run, message));
    worker.on('error', error =>
      this.setStatus(camera.id, run, E.CameraRunStatusEnum.ERROR, error.message)
    );
    worker.on('exit', code => {
      if (this.running.get(camera.id) !== run) return;
      // The worker died on its own (not stop()): save what it counted, say so.
      void this.flush(camera.id, run);
      this.running.delete(camera.id);
      this.publishStatus(camera.id, {
        ...this.runtimeOf(run),
        status: E.CameraRunStatusEnum.ERROR,
        error: `The camera worker stopped (${code}).`
      });
    });
    this.publishStatus(camera.id, this.runtimeOf(run));
  }

  async stop(cameraId: string): Promise<void> {
    const run = this.running.get(cameraId);
    if (!run) return;
    this.running.delete(cameraId);
    await this.flush(cameraId, run);
    this.send(run, { type: 'stop' });
    setTimeout(() => void run.worker.terminate(), 3000).unref();
    this.publishStatus(cameraId, {
      status: E.CameraRunStatusEnum.STOPPED,
      fps: 0,
      error: null,
      counts: sum(run.base, run.live),
      updatedAt: new Date()
    });
  }

  async restart(camera: CountingCameraEntity): Promise<void> {
    await this.stop(camera.id);
    await this.start(camera);
  }

  /** Saves what was counted so far, then counts from zero ("since reset"). */
  async reset(camera: CountingCameraEntity): Promise<void> {
    const run = this.running.get(camera.id);
    if (run) {
      await this.flush(camera.id, run);
      run.base = zero();
      run.live = zero();
      run.saved = zero();
      this.send(run, { type: 'reset' });
    }
    await this.cameraRepo.update(camera.id, { countsResetAt: new Date() });
    this.publishCount(camera.id, zero());
  }

  /** New confidence / classes / region for a running camera, without a restart. */
  update(
    cameraId: string,
    settings: { conf?: number; classes?: number[]; region?: RegionShape | null }
  ): void {
    const run = this.running.get(cameraId);
    if (run) this.send(run, { type: 'update', ...settings });
  }

  /** The camera now: running or not, and its counts since the last reset. */
  async runtime(camera: CountingCameraEntity): Promise<CameraRuntime> {
    const run = this.running.get(camera.id);
    if (run) return this.runtimeOf(run);
    const counts = await this.snapshotRepo.$totalSince(camera.id, camera.countsResetAt);
    return { status: E.CameraRunStatusEnum.STOPPED, fps: 0, error: null, counts, updatedAt: null };
  }

  /** What this run counted and has not saved yet (history adds it to the current hour). */
  unsaved(cameraId: string): Counts | null {
    const run = this.running.get(cameraId);
    return run ? minus(run.live, run.saved) : null;
  }

  /** One JPEG: the running worker's last frame, or one grabbed from the source. */
  async snapshot(camera: CountingCameraEntity): Promise<Buffer> {
    const run = this.running.get(camera.id);
    if (run) {
      const jpeg = await new Promise<Buffer | null>(resolve => {
        const requestId = this.nextRequestId++;
        const timer = setTimeout(() => {
          run.snapshots.delete(requestId);
          resolve(null);
        }, 5000);
        run.snapshots.set(requestId, image => {
          clearTimeout(timer);
          resolve(image);
        });
        this.send(run, { type: 'snapshot', requestId });
      });
      if (jpeg) return jpeg;
    }
    if (isManualSource(camera.sourceUrl))
      throw new NotFoundException('A manual counter has no camera picture.');
    // A phone has nothing to grab: only what its page sends while the camera runs.
    if (isPhoneSource(camera.sourceUrl))
      throw new NotFoundException(
        'No picture from the phone or PC yet: open this camera in the warehouse app on the device that films the belt and start filming.'
      );
    return grabJpeg({
      url: camera.sourceUrl,
      width: camera.width,
      height: camera.height,
      ffmpegPath: this.inference.ffmpegPath
    });
  }

  /** A phone camera's frame (JPEG) for its worker; false when the camera is not running. */
  pushFrame(cameraId: string, jpeg: Buffer): boolean {
    const run = this.running.get(cameraId);
    if (!run) return false;
    // A copy of its own (express may hand a slice of a shared buffer), moved to the worker, not copied.
    const bytes = new Uint8Array(jpeg);
    run.worker.postMessage({ type: 'frame', jpeg: bytes } satisfies ToWorker, [bytes.buffer]);
    return true;
  }

  /** A manual counter's counts since its reset, to the apps (MQTT), after a scan or a tap. */
  publishTotals(cameraId: string, counts: Counts): void {
    this.publishCount(cameraId, counts);
  }

  /** The annotated live preview (MJPEG): frames go to `listener` until the returned function is called. */
  watchPreview(cameraId: string, listener: (jpeg: Buffer) => void): (() => void) | null {
    const run = this.running.get(cameraId);
    if (!run) return null;
    run.previewListeners.add(listener);
    if (run.previewListeners.size === 1) this.send(run, { type: 'preview', on: true });
    return () => {
      run.previewListeners.delete(listener);
      if (!run.previewListeners.size) this.send(run, { type: 'preview', on: false });
    };
  }

  /**
   * Every minute: what each running camera counted since its last save (a crash loses at most a
   * minute; the history still adds the rows up per hour or day).
   */
  @Cron('* * * * *')
  async saveAll(): Promise<void> {
    for (const [cameraId, run] of this.running) await this.flush(cameraId, run);
  }

  private async flush(cameraId: string, run: Running): Promise<void> {
    const delta = minus(run.live, run.saved);
    if (!delta.in && !delta.out) return;
    const live = run.live;
    try {
      await this.snapshotRepo.$saveDelta(cameraId, delta);
      run.saved = { in: live.in, out: live.out, byClass: JSON.parse(JSON.stringify(live.byClass)) };
    } catch (error: any) {
      this.logger.error(`Counts of ${cameraId} not saved: ${error.message}`);
    }
  }

  private onMessage(cameraId: string, run: Running, message: FromWorker): void {
    switch (message.type) {
      case 'status':
        run.fps = message.fps;
        this.setStatus(cameraId, run, E.CameraRunStatusEnum[message.status], message.error ?? null);
        break;
      case 'count':
        run.live = message.counts;
        run.updatedAt = new Date();
        this.publishCount(cameraId, sum(run.base, run.live));
        break;
      case 'snapshot': {
        const done = run.snapshots.get(message.requestId);
        run.snapshots.delete(message.requestId);
        done?.(message.jpeg ? Buffer.from(message.jpeg) : null, message.error);
        break;
      }
      case 'preview': {
        const jpeg = Buffer.from(message.jpeg);
        run.previewListeners.forEach(listener => listener(jpeg));
        break;
      }
    }
  }

  private setStatus(
    cameraId: string,
    run: Running,
    status: E.CameraRunStatusEnum,
    error: string | null
  ): void {
    const changed = run.status !== status || run.error !== error;
    run.status = status;
    run.error = error;
    if (changed) {
      if (error) this.logger.warn(`${cameraId}: ${status} — ${error}`);
      this.publishStatus(cameraId, this.runtimeOf(run));
    }
  }

  private runtimeOf(run: Running): CameraRuntime {
    return {
      status: run.status,
      fps: run.fps,
      error: run.error,
      counts: sum(run.base, run.live),
      updatedAt: run.updatedAt
    };
  }

  private send(run: Running, message: ToWorker): void {
    run.worker.postMessage(message);
  }

  private publishCount(cameraId: string, counts: Counts): void {
    this.publish(C.mqttCameraCountTopic(cameraId), {
      cameraId,
      ...counts,
      at: new Date().toISOString()
    });
  }

  private publishStatus(cameraId: string, runtime: CameraRuntime): void {
    this.publish(C.mqttCameraStatusTopic(cameraId), {
      cameraId,
      status: runtime.status,
      fps: runtime.fps,
      error: runtime.error,
      at: new Date().toISOString()
    });
  }

  private publish(topic: string, payload: object): void {
    const { client } = this.mqtt;
    if (!client.connected) return;
    client.publish(topic, JSON.stringify(payload), { qos: 0, retain: true });
  }
}
