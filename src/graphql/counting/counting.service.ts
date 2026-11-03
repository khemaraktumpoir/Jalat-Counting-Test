import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { CountingViewer, warehouseScope } from 'src/repositories/counting-camera.repository';
import { hourStart, mergeByClass } from 'src/repositories/counting-snapshot.repository';

import { C, E } from '@common';
import { CountingCameraEntity } from '@entities';
import { PLATFORM_MODEL } from '@lib/counting';
import {
  isManualSource,
  isNetworkCamera,
  isStream,
  testVideoPreset,
  TestVideoPreset
} from '@lib/inference';
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
    this.checkModel(input.model);
    // A test video of cameras.json: its detector and its line or area come with it.
    const preset = testVideoPreset(input.sourceUrl);
    const warehouses = withWarehouses(this.newCameraWarehouses(askedWarehouses(input), viewer));
    await this.checkSameStream(input.sourceUrl, warehouses.warehouseIds);
    await this.checkOneNetworkCamera(input.sourceUrl, warehouses.warehouseIds);
    const camera = await this.cameraRepo.save(
      this.cameraRepo.create({
        name: input.name.trim(),
        sourceUrl: input.sourceUrl.trim(),
        enabled: input.enabled ?? false,
        ...schedule(input.startTime ?? null, input.endTime ?? null),
        fps: input.fps ?? C.DEFAULT_CAMERA_FPS,
        confThreshold: input.confThreshold ?? C.DEFAULT_CONF_THRESHOLD,
        classes: input.classes ?? [],
        width: input.width ?? 1280,
        height: input.height ?? 720,
        loop: input.loop ?? true,
        model: input.model ?? preset?.model ?? null,
        // A mobile warehouse's camera is its own, a registered Counter's some of its warehouses (the
        // ones it picked, else its first); Operation picks the warehouses (or none: the hub).
        ...warehouses,
        createdBy: viewer.id
      })
    );
    if (preset) await this.presetRegion(camera, preset, viewer.id);
    if (camera.enabled) await this.manager.start(camera);
    return camera;
  }

  /**
   * Where a new camera goes: for a mobile warehouse or a Counter, the warehouses asked for when they
   * are all theirs (refused otherwise), else their first; for Operation, the ones asked for or none.
   */
  private newCameraWarehouses(asked: string[] | undefined, viewer: CountingViewer): string[] {
    const scope = warehouseScope(viewer);
    if (!scope) return asked ?? [];
    if (!asked?.length) return [scope[0]];
    if (asked.some(w => !scope.includes(w)))
      throw new ForbiddenException('That is not one of your warehouses.');
    return asked;
  }

  /**
   * A saved camera's new warehouses: Operation sets any (none = the hub); a mobile warehouse or a
   * Counter only changes its own among them, keeps the others' and cannot leave itself none.
   */
  private changedWarehouses(
    camera: CountingCameraEntity,
    asked: string[],
    viewer: CountingViewer
  ): string[] {
    const scope = warehouseScope(viewer);
    if (!scope) return asked;
    if (asked.some(w => !scope.includes(w)))
      throw new ForbiddenException('A warehouse cannot give its camera to another warehouse.');
    if (!asked.length) throw new BadRequestException('Keep at least one of your warehouses.');
    const others = camera.warehouseIds.filter(w => !scope.includes(w));
    return [...new Set([...asked, ...others])];
  }

  /**
   * A network camera (a stream address) is added once per warehouse: another camera on the same
   * address in one of these warehouses (none: the hub's) is refused — tick more warehouses on that
   * one instead. Phones, counting by scanning and video files are not checked.
   */
  private async checkSameStream(
    sourceUrl: string,
    warehouseIds: string[],
    exceptId?: string
  ): Promise<void> {
    const url = sourceUrl.trim();
    if (!isStream(url)) return;
    const same = await this.cameraRepo.find({ where: { sourceUrl: url } });
    const taken = same.find(
      c =>
        c.id !== exceptId &&
        (warehouseIds.length
          ? c.warehouseIds.some(w => warehouseIds.includes(w))
          : !c.warehouseIds.length)
    );
    if (taken)
      throw new BadRequestException(
        `"${taken.name}" already uses this camera address for that warehouse. Tick more warehouses on it instead of adding it again.`
      );
  }

  /**
   * A warehouse has one network camera: another one in one of these warehouses (none: the hub's)
   * is refused — change that one's address instead, or delete it first. Phones (this app or an
   * IP-camera app), counting by scanning and video files are not network cameras.
   */
  private async checkOneNetworkCamera(
    sourceUrl: string,
    warehouseIds: string[],
    exceptId?: string
  ): Promise<void> {
    if (!isNetworkCamera(sourceUrl)) return;
    const cameras = await this.cameraRepo.find();
    const taken = cameras.find(
      c =>
        c.id !== exceptId &&
        isNetworkCamera(c.sourceUrl) &&
        (warehouseIds.length
          ? c.warehouseIds.some(w => warehouseIds.includes(w))
          : !c.warehouseIds.length)
    );
    if (taken)
      throw new BadRequestException(
        `"${taken.name}" is already this warehouse's network camera: a warehouse has one. Change its address instead, or delete it first.`
      );
  }

  /**
   * A new camera on a test video: the line or area of cameras.json, scaled to the camera's
   * picture size when another was chosen. Left to draw by hand if it would not fit.
   */
  private async presetRegion(
    camera: CountingCameraEntity,
    preset: TestVideoPreset,
    by: string
  ): Promise<void> {
    const type = E.RegionTypeEnum[preset.region.type];
    const points = preset.region.points.map(p => ({
      x: Math.round((p.x * camera.width) / preset.width),
      y: Math.round((p.y * camera.height) / preset.height)
    }));
    if (!type || regionProblem(type, points, camera.width, camera.height)) return;
    await this.regionRepo.$saveForCamera(camera.id, type, points, by);
  }

  async update(
    input: I.UpdateCountingCameraInput,
    viewer: CountingViewer
  ): Promise<CountingCameraEntity> {
    const camera = await this.camera(input.id, viewer);
    this.checkClasses(input.classes);
    if (input.model !== undefined && input.model !== camera.model) this.checkModel(input.model);
    const asked = askedWarehouses(input);
    const warehouses: Partial<ReturnType<typeof withWarehouses>> = asked
      ? withWarehouses(this.changedWarehouses(camera, asked, viewer))
      : {};
    const { id, warehouseId: _one, warehouseIds: _all, startTime, endTime, ...changes } = input;
    // A schedule changes as a whole: the time not sent stays as it was.
    const times =
      startTime !== undefined || endTime !== undefined
        ? schedule(
            startTime === undefined ? camera.startTime : startTime,
            endTime === undefined ? camera.endTime : endTime
          )
        : {};
    if (changes.sourceUrl !== undefined || asked) {
      const url = changes.sourceUrl ?? camera.sourceUrl;
      const ids = warehouses.warehouseIds ?? camera.warehouseIds;
      await this.checkSameStream(url, ids, id);
      await this.checkOneNetworkCamera(url, ids, id);
    }
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
      ...times,
      ...warehouses,
      name: changes.name?.trim() ?? camera.name
    });

    // The stream or the detector changed: restart; only the detection settings: update the running worker.
    // Off, or outside its schedule now: stopped (the schedule starts it again at its start time).
    const streamChanged = ['sourceUrl', 'fps', 'width', 'height', 'loop', 'model'].some(
      key => (changes as any)[key] !== undefined && (changes as any)[key] !== (camera as any)[key]
    );
    if (!saved.enabled || !this.manager.inScheduleNow(saved)) await this.manager.stop(id);
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
      classes: this.classes(),
      platform: this.inference.platformAvailable
    };
  }

  /** A camera set to run on Ultralytics Platform needs it set up on this service. */
  private checkModel(model?: string | null): void {
    if (model === PLATFORM_MODEL && !this.inference.platformAvailable)
      throw new BadRequestException(
        'Ultralytics Platform is not set up on the counting service: set ULTRALYTICS_ENDPOINT_URL and ULTRALYTICS_API_KEY in its .env.'
      );
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

/** The warehouses an input asks for, once each (warehouseIds, else the one warehouseId); none asked: undefined. */
function askedWarehouses(input: {
  warehouseId?: string;
  warehouseIds?: string[];
}): string[] | undefined {
  const ids =
    input.warehouseIds ?? (input.warehouseId !== undefined ? [input.warehouseId] : undefined);
  return ids && [...new Set(ids.map(w => w.trim()).filter(Boolean))];
}

/** Both columns: the list, and its first for the clients from before. */
function withWarehouses(ids: string[]): { warehouseIds: string[]; warehouseId: string | null } {
  return { warehouseIds: ids, warehouseId: ids[0] ?? null };
}

/** A camera's schedule: a start and an end (not the same time), or neither (all day). */
function schedule(
  startTime: string | null,
  endTime: string | null
): { startTime: string | null; endTime: string | null } {
  if (!startTime && !endTime) return { startTime: null, endTime: null };
  if (!startTime || !endTime)
    throw new BadRequestException('A schedule needs both a start and an end time.');
  if (startTime === endTime)
    throw new BadRequestException('The start and end of a schedule must differ.');
  return { startTime, endTime };
}
