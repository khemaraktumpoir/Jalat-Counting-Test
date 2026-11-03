import { applyDecorators, ForbiddenException } from '@nestjs/common';
import { Args, ID, Int, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';

import { ArgsId, Auth, C, CurrentUser, E, Permission } from '@common';
import { User } from '@graphql/user';
import { isManualSource, listTestVideos, testVideoPresets } from '@lib/inference';

import * as I from './counting.input';
import * as M from './counting.model';
import { CountingService } from './counting.service';
import { PhotoCountService } from './photo-count.service';

const P = C.COUNTING_PERMISSIONS;

/**
 * Warehouses (their own cameras), Operation and admins (every camera); an account with a role (e.g.
 * Counter) also needs these permission codes.
 */
const Counting = (...codes: C.CountingPermission[]) =>
  applyDecorators(Auth('ADMIN', 'OPERATION', 'MOBILE_WAREHOUSE'), Permission(...codes));

@Resolver(() => M.CountingCamera)
export class CountingResolver {
  constructor(
    private readonly service: CountingService,
    private readonly photos: PhotoCountService
  ) {}

  // ===========================
  // ---- QUERY ----
  // ===========================
  @Counting(P.READ)
  @Query(() => [M.CountingCamera])
  countingCameras(@CurrentUser() user: User) {
    return this.service.cameras(user);
  }

  @Counting(P.READ)
  @Query(() => M.CountingCamera)
  countingCamera(@ArgsId() id: string, @CurrentUser() user: User) {
    return this.service.camera(id, user);
  }

  @Counting(P.READ)
  @Query(() => [M.CountingHistoryBucket])
  countingHistory(@Args() args: I.CountingHistoryArgs, @CurrentUser() user: User) {
    return this.service.history(args, user);
  }

  @Counting(P.READ)
  @Query(() => [M.CountingClass], {
    description: 'The labels the model knows (models/classes.json).'
  })
  countingClasses() {
    return this.service.classes();
  }

  @Counting(P.COUNT)
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

  @Counting(P.READ)
  @Query(() => [M.PhotoBatch], {
    description:
      'Batches of counted photos between from and to, newest first (a warehouse: its own).'
  })
  countingPhotoBatches(@Args() args: I.PhotoBatchesArgs, @CurrentUser() user: User) {
    return this.photos.batches(user, new Date(args.from), new Date(args.to), args.search);
  }

  @Counting(P.READ)
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

  @Counting(P.COUNT)
  @Mutation(() => Boolean, {
    description:
      'Names a batch of counted photos (a driver, a pickup, a truck…); no note clears it.'
  })
  namePhotoBatch(@Args('input') input: I.NamePhotoBatchInput, @CurrentUser() user: User) {
    return this.photos.nameBatch(user, input);
  }

  @Counting(P.COUNT)
  @Mutation(() => Boolean, {
    description: 'Deletes a batch counted by mistake: its photos leave every total.'
  })
  deletePhotoBatch(
    @Args('batchId', { type: () => ID }) batchId: string,
    @CurrentUser() user: User
  ) {
    return this.photos.deleteBatch(user, batchId);
  }

  @Counting(P.COUNT)
  @Mutation(() => M.PhotoRecord, {
    description:
      'A counted photo fixed by hand: parcels the model missed (added) and boxes that are not parcels (removed). The batch counts follow.'
  })
  correctPhotoCount(@Args('input') input: I.CorrectPhotoCountInput, @CurrentUser() user: User) {
    return this.photos.correctCount(user, input);
  }

  @Counting(P.COUNT)
  @Mutation(() => M.PhotoRecord, {
    description:
      'Marks how many parcels of a counted photo an earlier photo of its batch already shows (one parcel photographed twice): the batch counts them once. 0 clears it.'
  })
  markPhotoRepeats(@Args('input') input: I.MarkPhotoRepeatsInput, @CurrentUser() user: User) {
    return this.photos.markRepeats(user, input);
  }

  @Counting(P.READ)
  @Query(() => M.PhotoModelInfo, {
    description: "What counts photos: the parcel model (default), or the cameras' model."
  })
  countingPhotoModel() {
    return this.photos.modelInfo();
  }

  @Counting(P.READ)
  @Query(() => [String], {
    description: 'The folders countingPhotoFolder may read (PHOTO_ROOTS).'
  })
  countingPhotoRoots() {
    return this.photos.rootNames();
  }

  @Counting(P.READ)
  @Query(() => [String], {
    description:
      'Test videos on the counting service (test-videos/ and its folders), as a camera source takes them: e.g. "test-videos/real-2026-10-27/video.mp4".'
  })
  countingTestVideos() {
    return listTestVideos();
  }

  @Counting(P.READ)
  @Query(() => [M.CountingTestVideo], {
    description:
      'The test videos ready to use as a camera (test-videos/cameras.json): a camera created on one gets its detector and its line or area.'
  })
  countingTestVideoPresets(): M.CountingTestVideo[] {
    return testVideoPresets().map(p => ({
      sourceUrl: p.sourceUrl,
      name: p.name,
      about: p.about,
      fps: p.fps,
      confThreshold: p.confThreshold,
      width: p.width,
      height: p.height,
      loop: p.loop,
      model: p.model ?? null,
      regionType: E.RegionTypeEnum[p.region.type],
      expectedIn: p.expected.in,
      expectedOut: p.expected.out
    }));
  }

  @Counting(P.READ)
  @Query(() => M.CountingModelInfo)
  countingModel() {
    return this.service.model();
  }

  @Counting()
  @Query(() => [String], {
    description:
      "What the signed-in account may do here (COUNTING:READ, COUNT, CONTROL, SETTING): all of them without a role, else its role's."
  })
  countingPermissions(@CurrentUser() user: User) {
    return user.permissions ?? [];
  }

  // ===========================
  // ---- MUTATION ----
  // ===========================
  // A manual counter (Count by scanning, made on first use) needs COUNT; a camera needs SETTING.
  @Counting()
  @Mutation(() => M.CountingCamera)
  createCountingCamera(
    @Args('input') input: I.CreateCountingCameraInput,
    @CurrentUser() user: User
  ) {
    const needs = isManualSource(input.sourceUrl) ? P.COUNT : P.SETTING;
    if (!user.permissions?.includes(needs))
      throw new ForbiddenException(`Your role may not do this (needs ${needs}).`);
    return this.service.create(input, user);
  }

  @Counting(P.SETTING)
  @Mutation(() => M.CountingCamera)
  updateCountingCamera(
    @Args('input') input: I.UpdateCountingCameraInput,
    @CurrentUser() user: User
  ) {
    return this.service.update(input, user);
  }

  @Counting(P.SETTING)
  @Mutation(() => Boolean)
  deleteCountingCamera(@ArgsId() id: string, @CurrentUser() user: User) {
    return this.service.remove(id, user);
  }

  @Counting(P.CONTROL)
  @Mutation(() => M.CountingCamera, {
    description: 'Starts counting (and with the service from now on).'
  })
  startCountingCamera(@ArgsId() id: string, @CurrentUser() user: User) {
    return this.service.start(id, user);
  }

  @Counting(P.CONTROL)
  @Mutation(() => M.CountingCamera)
  stopCountingCamera(@ArgsId() id: string, @CurrentUser() user: User) {
    return this.service.stop(id, user);
  }

  @Counting(P.CONTROL)
  @Mutation(() => M.CountingCamera, {
    description: 'Saves the counts so far, then counts "since reset" from zero.'
  })
  resetCountingCamera(@ArgsId() id: string, @CurrentUser() user: User) {
    return this.service.reset(id, user);
  }

  @Counting(P.SETTING)
  @Mutation(() => M.CountingRegion)
  saveCountingRegion(@Args('input') input: I.SaveCountingRegionInput, @CurrentUser() user: User) {
    return this.service.saveRegion(input, user);
  }

  @Counting(P.READ)
  @Query(() => M.CountingOverview, {
    description:
      'Every visible source counted between from and to (e.g. today), and per hour or day: cameras vs counting by scanning.'
  })
  countingOverview(@Args() args: I.CountingOverviewArgs, @CurrentUser() user: User) {
    return this.service.overview(args, user);
  }

  @Counting(P.COUNT)
  @Mutation(() => M.ManualCountResult, {
    description:
      'A manual counter ("manual:"): count a parcel by its QR code (once since the last reset) or a tap; delta -1 takes it back.'
  })
  addManualCount(@Args('input') input: I.AddManualCountInput, @CurrentUser() user: User) {
    return this.service.addManualCount(input, user);
  }

  @Counting(P.READ)
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
