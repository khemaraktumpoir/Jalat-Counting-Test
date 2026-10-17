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
import {
  CountingCameraRepository,
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

/** Midnight in Phnom Penh (UTC+7, no daylight saving). */
function dayStart(at: Date): Date {
  const offset = 7 * 3600e3;
  return new Date(Math.floor((at.getTime() + offset) / 86_400_000) * 86_400_000 - offset);
}
