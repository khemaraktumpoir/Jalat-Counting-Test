import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';

import { ArgsId, Auth, CurrentUser } from '@common';
import { User } from '@graphql/user';

import * as I from './counting.input';
import * as M from './counting.model';
import { CountingService } from './counting.service';

/** Warehouses (their own cameras), Operation and admins (every camera). */
const Counting = () => Auth('ADMIN', 'OPERATION', 'MOBILE_WAREHOUSE');

@Resolver(() => M.CountingCamera)
export class CountingResolver {
  constructor(private readonly service: CountingService) {}

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
