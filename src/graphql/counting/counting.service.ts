import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { CountingViewer } from 'src/repositories/counting-camera.repository';
import { hourStart, mergeByClass } from 'src/repositories/counting-snapshot.repository';

import { C, E } from '@common';
import { CountingCameraEntity } from '@entities';
import { isManualSource } from '@lib/inference';
import {
  CountingCameraRepository,
  CountingManualScanRepository,
  CountingRegionRepository,
  CountingSnapshotRepository
} from '@repositories';

import { CameraManagerService, regionShapeOf } from './camera-manager.service';
import * as I from './counting.input';
import * as M from './counting.model';
import { byClassList, classList, regionProblem } from './counting.rules';
import { InferenceService } from './inference.service';

const isWarehouse = (viewer: CountingViewer) => viewer.userType === E.UserTypeEnum.MOBILE_WAREHOUSE;

@Injectable()
export class CountingService {
  constructor(
    private readonly cameraRepo: CountingCameraRepository,
    private readonly regionRepo: CountingRegionRepository,
    private readonly snapshotRepo: CountingSnapshotRepository,
    private readonly manualScanRepo: CountingManualScanRepository,
    private readonly manager: CameraManagerService,
    private readonly inference: InferenceService
  ) {}

  cameras(viewer: CountingViewer): Promise<CountingCameraEntity[]> {
    return this.cameraRepo.$findVisible(viewer);
  }

  /** A camera the user may see, or NotFound (also for another warehouse's camera). */
  async camera(id: string, viewer: CountingViewer): Promise<CountingCameraEntity> {
    const camera = await this.cameraRepo.$findVisibleById(id, viewer);
    if (!camera) throw new NotFoundException('Camera not found.');
    return camera;
  }

  async create(
    input: I.CreateCountingCameraInput,
    viewer: CountingViewer
  ): Promise<CountingCameraEntity> {
    this.checkClasses(input.classes);
    const camera = await this.cameraRepo.save(
      this.cameraRepo.create({
        name: input.name.trim(),
        sourceUrl: input.sourceUrl.trim(),
        enabled: input.enabled ?? false,
        fps: input.fps ?? C.DEFAULT_CAMERA_FPS,
        confThreshold: input.confThreshold ?? C.DEFAULT_CONF_THRESHOLD,
        classes: input.classes ?? [],
        width: input.width ?? 1280,
        height: input.height ?? 720,
        loop: input.loop ?? true,
        // A mobile warehouse's camera is its own; Operation picks the warehouse (or none: the hub).
        warehouseId: isWarehouse(viewer) ? viewer.id : input.warehouseId ?? null,
        createdBy: viewer.id
      })
    );
    if (camera.enabled) await this.manager.start(camera);
    return camera;
  }

  async update(
    input: I.UpdateCountingCameraInput,
    viewer: CountingViewer
  ): Promise<CountingCameraEntity> {
    const camera = await this.camera(input.id, viewer);
    this.checkClasses(input.classes);
    if (isWarehouse(viewer) && input.warehouseId !== undefined && input.warehouseId !== viewer.id) {
      throw new ForbiddenException('A warehouse cannot give its camera to another warehouse.');
    }
    const { id, ...changes } = input;
    const sizeChanged =
      (changes.width !== undefined && changes.width !== camera.width) ||
      (changes.height !== undefined && changes.height !== camera.height);
    if (sizeChanged) {
      const region = await this.regionRepo.findOne({ where: { cameraId: id } });
      const problem =
        region &&
        regionProblem(
          region.type,
          region.points,
          changes.width ?? camera.width,
          changes.height ?? camera.height
        );
      if (problem)
        throw new BadRequestException(`${problem} Draw the region again after changing the size.`);
    }
    const saved = await this.cameraRepo.save({
      ...camera,
      ...changes,
      name: changes.name?.trim() ?? camera.name
    });

    // The stream itself changed: restart; only the detection settings: update the running worker.
    const streamChanged = ['sourceUrl', 'fps', 'width', 'height', 'loop'].some(
      key => (changes as any)[key] !== undefined && (changes as any)[key] !== (camera as any)[key]
    );
    if (!saved.enabled) await this.manager.stop(id);
    else if (!this.manager.isRunning(id)) await this.manager.start(saved);
    else if (streamChanged) await this.manager.restart(saved);
    else this.manager.update(id, { conf: saved.confThreshold, classes: saved.classes });
    return saved;
  }

  async remove(id: string, viewer: CountingViewer): Promise<boolean> {
    const camera = await this.camera(id, viewer);
    await this.manager.stop(camera.id);
    await this.regionRepo.delete({ cameraId: camera.id });
    await this.snapshotRepo.delete({ cameraId: camera.id });
    await this.manualScanRepo.delete({ cameraId: camera.id });
    await this.cameraRepo.delete(camera.id);
    return true;
  }

  async start(id: string, viewer: CountingViewer): Promise<CountingCameraEntity> {
    const camera = await this.camera(id, viewer);
    await this.cameraRepo.update(camera.id, { enabled: true });
    await this.manager.start({ ...camera, enabled: true });
    return { ...camera, enabled: true };
  }

  async stop(id: string, viewer: CountingViewer): Promise<CountingCameraEntity> {
    const camera = await this.camera(id, viewer);
    await this.cameraRepo.update(camera.id, { enabled: false });
    await this.manager.stop(camera.id);
    return { ...camera, enabled: false };
  }

  async reset(id: string, viewer: CountingViewer): Promise<CountingCameraEntity> {
    const camera = await this.camera(id, viewer);
    await this.manager.reset(camera);
    return this.camera(id, viewer);
  }

  /**
   * A parcel counted by hand: a scanned QR code (once since the last reset; again = duplicate,
   * not counted), or a tap without a code. -1 takes back that code, or one tap. Saved as a count
   * (history, "since reset") split into scanned / tapped, and sent to the apps live.
   */
  async addManualCount(
    input: I.AddManualCountInput,
    viewer: CountingViewer
  ): Promise<M.ManualCountResult> {
    const camera = await this.camera(input.cameraId, viewer);
    if (!isManualSource(camera.sourceUrl))
      throw new BadRequestException('This is a camera, not a manual counter.');
    const delta = input.delta ?? 1;
    if (delta !== 1 && delta !== -1) throw new BadRequestException('delta is 1 or -1.');
    const code = input.code?.trim() || undefined;
    const since = camera.countsResetAt;
    const before = await this.snapshotRepo.$totalSince(camera.id, since);
    const result = (counted: boolean, duplicate: boolean, totals = before) => ({
      counted,
      duplicate,
      code,
      total: totals.in,
      scanned: totals.byClass[MANUAL_SCANNED]?.in ?? 0,
      tapped: totals.byClass[MANUAL_TAPPED]?.in ?? 0
    });

    if (code) {
      const scan = await this.manualScanRepo.$findSince(camera.id, code, since);
      if (delta > 0 && scan) return result(false, true);
      if (delta < 0 && !scan) return result(false, false);
      if (delta > 0)
        await this.manualScanRepo.insert({ cameraId: camera.id, code, createdBy: viewer.id });
      else await this.manualScanRepo.delete(scan!.id);
    } else if (delta < 0 && !(before.byClass[MANUAL_TAPPED]?.in > 0)) {
      // Nothing tapped to take back.
      return result(false, false);
    }

    const label = code ? MANUAL_SCANNED : MANUAL_TAPPED;
    await this.snapshotRepo.$saveDelta(camera.id, {
      in: delta,
      out: 0,
      byClass: { [label]: { in: delta, out: 0 } }
    });
    const after = await this.snapshotRepo.$totalSince(camera.id, since);
    this.manager.publishTotals(camera.id, after);
    return result(true, false, after);
  }

  /** The latest QR codes counted on a manual counter since its reset, newest first. */
  async manualScans(
    cameraId: string,
    limit: number,
    viewer: CountingViewer
  ): Promise<M.ManualScan[]> {
    const camera = await this.camera(cameraId, viewer);
    const rows = await this.manualScanRepo.$latestSince(
      camera.id,
      camera.countsResetAt,
      Math.min(Math.max(limit, 1), 200)
    );
    return rows.map(r => ({ code: r.code, createdAt: r.createdAt }));
  }

  async saveRegion(
    input: I.SaveCountingRegionInput,
    viewer: CountingViewer
  ): Promise<M.CountingRegion> {
    const camera = await this.camera(input.cameraId, viewer);
    const points = input.points.map(p => ({
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10
    }));
    const problem = regionProblem(input.type, points, camera.width, camera.height);
    if (problem) throw new BadRequestException(problem);
    const region = await this.regionRepo.$saveForCamera(camera.id, input.type, points, viewer.id);
    // A running camera counts with the new region right away (its counts start over).
    this.manager.update(camera.id, { region: regionShapeOf(region) });
    return region;
  }

  async region(cameraId: string): Promise<M.CountingRegion | null> {
    return this.regionRepo.findOne({ where: { cameraId } });
  }

  async runtime(camera: CountingCameraEntity): Promise<M.CountingRuntime> {
    const runtime = await this.manager.runtime(camera);
    return {
      status: runtime.status,
      fps: runtime.fps,
      error: runtime.error ?? undefined,
      in: runtime.counts.in,
      out: runtime.counts.out,
      byClass: byClassList(runtime.counts.byClass),
      updatedAt: runtime.updatedAt ?? undefined
    };
  }

  /** Counts per hour or day; the current hour includes what was counted but not saved yet. */
  async history(
    args: I.CountingHistoryArgs,
    viewer: CountingViewer
  ): Promise<M.CountingHistoryBucket[]> {
    const camera = await this.camera(args.cameraId, viewer);
    const from = new Date(args.from);
    const to = new Date(args.to);
    if (!(from < to)) throw new BadRequestException('"from" must be before "to".');
    if (to.getTime() - from.getTime() > 366 * 24 * 3600e3)
      throw new BadRequestException('A year at most.');
    const rows = await this.snapshotRepo.$history(camera.id, from, to, args.bucket);

    const unsaved = this.manager.unsaved(camera.id);
    const now = new Date();
    if (unsaved && (unsaved.in || unsaved.out) && now >= from && now < to) {
      const period = args.bucket === E.CountBucketEnum.DAY ? dayStart(now) : hourStart(now);
      let row = rows.find(r => r.periodStart.getTime() === period.getTime());
      if (!row) {
        row = { periodStart: period, in: 0, out: 0, byClass: {} };
        rows.push(row);
      }
      row.in += unsaved.in;
      row.out += unsaved.out;
      mergeByClass(row.byClass, unsaved.byClass);
    }
    return rows.map(r => ({
      periodStart: r.periodStart,
      in: r.in,
      out: r.out,
      byClass: byClassList(r.byClass)
    }));
  }

  /**
   * Every source the user sees, counted between from and to (e.g. today in Phnom Penh), and per
   * hour or day split into cameras and counting by scanning: the Count page compares the two. The
   * current hour includes what running cameras counted but did not save yet.
   */
  async overview(
    args: I.CountingOverviewArgs,
    viewer: CountingViewer
  ): Promise<M.CountingOverview> {
    const from = new Date(args.from);
    const to = new Date(args.to);
    if (!(from < to)) throw new BadRequestException('"from" must be before "to".');
    if (to.getTime() - from.getTime() > 366 * 24 * 3600e3)
      throw new BadRequestException('A year at most.');
    const cameras = await this.cameraRepo.$findVisible(viewer);
    const ids = cameras.map(c => c.id);
    const manual = new Set(cameras.filter(c => isManualSource(c.sourceUrl)).map(c => c.id));
    const [totals, rows] = await Promise.all([
      this.snapshotRepo.$totalsByCamera(ids, from, to),
      this.snapshotRepo.$bucketsByCamera(ids, from, to, args.bucket)
    ]);

    // What running cameras counted since their last save (at most a minute), in this hour.
    const now = new Date();
    const current = args.bucket === E.CountBucketEnum.DAY ? dayStart(now) : hourStart(now);
    if (now >= from && now < to) {
      for (const id of ids) {
        const unsaved = this.manager.unsaved(id);
        if (!unsaved || (!unsaved.in && !unsaved.out)) continue;
        const total = totals.get(id) ?? { in: 0, out: 0, byClass: {} };
        total.in += unsaved.in;
        total.out += unsaved.out;
        mergeByClass(total.byClass, unsaved.byClass);
        totals.set(id, total);
        rows.push({ cameraId: id, periodStart: current, in: unsaved.in, out: unsaved.out });
      }
    }

    const buckets = new Map<number, M.CountingOverviewBucket>();
    for (const row of rows) {
      const key = row.periodStart.getTime();
      const b = buckets.get(key) ?? {
        periodStart: row.periodStart,
        cameraIn: 0,
        cameraOut: 0,
        manualIn: 0
      };
      if (manual.has(row.cameraId)) b.manualIn += row.in;
      else {
        b.cameraIn += row.in;
        b.cameraOut += row.out;
      }
      buckets.set(key, b);
    }
    return {
      sources: cameras.map(c => {
        const t = totals.get(c.id) ?? { in: 0, out: 0, byClass: {} };
        return { cameraId: c.id, in: t.in, out: t.out, byClass: byClassList(t.byClass) };
      }),
      buckets: [...buckets.values()].sort(
        (a, b) => a.periodStart.getTime() - b.periodStart.getTime()
      )
    };
  }

  classes(): M.CountingClass[] {
    return classList(this.inference.labels);
  }

  model(): M.CountingModelInfo {
    return {
      loaded: this.inference.modelLoaded,
      error: this.inference.modelError ?? undefined,
      provider: this.inference.provider,
      classes: this.classes()
    };
  }

  private checkClasses(classes?: number[]): void {
    const unknown = (classes ?? []).filter(id => this.inference.labels[id] === undefined);
    if (unknown.length && Object.keys(this.inference.labels).length) {
      throw new BadRequestException(
        `Unknown class ids: ${unknown.join(', ')} (see countingClasses).`
      );
    }
  }
}

/** The counts of a manual counter, by how the parcel was counted (its byClass labels). */
export const MANUAL_SCANNED = 'scanned';
export const MANUAL_TAPPED = 'tapped';

/** Midnight in Phnom Penh (UTC+7, no daylight saving). */
function dayStart(at: Date): Date {
  const offset = 7 * 3600e3;
  return new Date(Math.floor((at.getTime() + offset) / 86_400_000) * 86_400_000 - offset);
}
