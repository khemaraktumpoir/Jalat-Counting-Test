import { Args, ID, Int, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';

import { ArgsId, Auth, CurrentUser } from '@common';
import { User } from '@graphql/user';

import * as I from './counting.input';
import * as M from './counting.model';
import { CountingService } from './counting.service';
import { PhotoCountService } from './photo-count.service';

/** Warehouses (their own cameras), Operation and admins (every camera). */
const Counting = () => Auth('ADMIN', 'OPERATION', 'MOBILE_WAREHOUSE');

@Resolver(() => M.CountingCamera)
export class CountingResolver {
  constructor(
    private readonly service: CountingService,
    private readonly photos: PhotoCountService
  ) {}

  // ===========================
  // ---- QUERY ----
  // ===========================
  @Counting()
  @Query(() => [M.CountingCamera])
  countingCameras(@CurrentUser() user: User) {
    return this.service.cameras(user);
  }

  @Counting()
  @Query(() => M.CountingCamera)
  countingCamera(@ArgsId() id: string, @CurrentUser() user: User) {
    return this.service.camera(id, user);
  }

  @Counting()
  @Query(() => [M.CountingHistoryBucket])
  countingHistory(@Args() args: I.CountingHistoryArgs, @CurrentUser() user: User) {
    return this.service.history(args, user);
  }

  @Counting()
  @Query(() => [M.CountingClass], {
    description: 'The labels the model knows (models/classes.json).'
  })
  countingClasses() {
    return this.service.classes();
  }

  @Counting()
  @Query(() => M.PhotoFolderCount, {
    description:
      "Counts the objects in every photo of a folder on the counting service (inside PHOTO_ROOTS), with the cameras' model. Upload photos instead with POST /api/v1/counting/photos."
  })
  countingPhotoFolder(@Args() args: I.PhotoFolderArgs, @CurrentUser() user: User) {
    return this.photos.countFolder(
      args.path,
      { conf: args.conf, classes: args.classes },
      args.limit,
      user
    );
  }

  @Counting()
  @Query(() => [M.PhotoBatch], {
    description:
      'Batches of counted photos between from and to, newest first (a warehouse: its own).'
  })
  countingPhotoBatches(@Args() args: I.PhotoBatchesArgs, @CurrentUser() user: User) {
    return this.photos.batches(user, new Date(args.from), new Date(args.to));
  }

  @Counting()
  @Query(() => [M.PhotoRecord], {
    description:
      "Counted photos: one batch's (batchId), or the copies (copiesOnly) between from and to; each with the photo it repeats."
  })
  countingPhotoRecords(@Args() args: I.PhotoRecordsArgs, @CurrentUser() user: User) {
    const to = args.to ? new Date(args.to) : new Date();
    const from = args.from ? new Date(args.from) : new Date(to.getTime() - 7 * 86_400_000);
    return this.photos.photoRecords(user, {
      batchId: args.batchId,
      copiesOnly: args.copiesOnly,
      from,
      to,
      limit: args.limit
    });
  }

  @Counting()
  @Query(() => M.PhotoModelInfo, {
    description: "What counts photos: the parcel model (default), or the cameras' model."
  })
  countingPhotoModel() {
    return this.photos.modelInfo();
  }

  @Counting()
  @Query(() => [String], {
    description: 'The folders countingPhotoFolder may read (PHOTO_ROOTS).'
  })
  countingPhotoRoots() {
    return this.photos.rootNames();
  }

  @Counting()
  @Query(() => M.CountingModelInfo)
  countingModel() {
    return this.service.model();
  }

  // ===========================
  // ---- MUTATION ----
  // ===========================
  @Counting()
  @Mutation(() => M.CountingCamera)
  createCountingCamera(
    @Args('input') input: I.CreateCountingCameraInput,
    @CurrentUser() user: User
  ) {
    return this.service.create(input, user);
  }

  @Counting()
  @Mutation(() => M.CountingCamera)
  updateCountingCamera(
    @Args('input') input: I.UpdateCountingCameraInput,
    @CurrentUser() user: User
  ) {
    return this.service.update(input, user);
  }

  @Counting()
  @Mutation(() => Boolean)
  deleteCountingCamera(@ArgsId() id: string, @CurrentUser() user: User) {
    return this.service.remove(id, user);
  }

  @Counting()
  @Mutation(() => M.CountingCamera, {
    description: 'Starts counting (and with the service from now on).'
  })
  startCountingCamera(@ArgsId() id: string, @CurrentUser() user: User) {
    return this.service.start(id, user);
  }

  @Counting()
  @Mutation(() => M.CountingCamera)
  stopCountingCamera(@ArgsId() id: string, @CurrentUser() user: User) {
    return this.service.stop(id, user);
  }

  @Counting()
  @Mutation(() => M.CountingCamera, {
    description: 'Saves the counts so far, then counts "since reset" from zero.'
  })
  resetCountingCamera(@ArgsId() id: string, @CurrentUser() user: User) {
    return this.service.reset(id, user);
  }

  @Counting()
  @Mutation(() => M.CountingRegion)
  saveCountingRegion(@Args('input') input: I.SaveCountingRegionInput, @CurrentUser() user: User) {
    return this.service.saveRegion(input, user);
  }

  @Counting()
  @Query(() => M.CountingOverview, {
    description:
      'Every visible source counted between from and to (e.g. today), and per hour or day: cameras vs counting by scanning.'
  })
  countingOverview(@Args() args: I.CountingOverviewArgs, @CurrentUser() user: User) {
    return this.service.overview(args, user);
  }

  @Counting()
  @Mutation(() => M.ManualCountResult, {
    description:
      'A manual counter ("manual:"): count a parcel by its QR code (once since the last reset) or a tap; delta -1 takes it back.'
  })
  addManualCount(@Args('input') input: I.AddManualCountInput, @CurrentUser() user: User) {
    return this.service.addManualCount(input, user);
  }

  @Counting()
  @Query(() => [M.ManualScan], {
    description: "A manual counter's latest QR codes since its last reset, newest first."
  })
  countingManualScans(
    @Args('cameraId', { type: () => ID }) cameraId: string,
    @Args('limit', { type: () => Int, defaultValue: 50 }) limit: number,
    @CurrentUser() user: User
  ) {
    return this.service.manualScans(cameraId, limit, user);
  }

  // ===========================
  // ---- RESOLVE FIELD ----
  // ===========================
  @ResolveField(() => M.CountingRegion, { nullable: true })
  region(@Parent() camera: M.CountingCamera) {
    return this.service.region(camera.id);
  }

  @ResolveField(() => M.CountingRuntime)
  runtime(@Parent() camera: M.CountingCamera) {
    return this.service.runtime(camera as any);
  }
}
