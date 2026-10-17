import { Field, Float, GraphQLISODateTime, ID, Int, ObjectType } from '@nestjs/graphql';

import { E } from '@common';

@ObjectType()
export class CountingPoint {
  @Field(() => Float)
  x!: number;

  @Field(() => Float)
  y!: number;
}

@ObjectType()
export class CountingClassCount {
  @Field()
  label!: string;

  @Field(() => Int)
  in!: number;

  @Field(() => Int)
  out!: number;
}

@ObjectType()
export class CountingRegion {
  @Field(() => ID)
  id!: string;

  @Field(() => E.RegionTypeEnum)
  type!: E.RegionTypeEnum;

  @Field(() => [CountingPoint], {
    description:
      'In camera pixels (width × height). A line: IN is to the left of point 1 → point 2.'
  })
  points!: CountingPoint[];

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}

@ObjectType({ description: 'The camera now: its worker and its counts since the last reset.' })
export class CountingRuntime {
  @Field(() => E.CameraRunStatusEnum)
  status!: E.CameraRunStatusEnum;

  @Field(() => Float, { description: 'Frames counted a second (the last 5 seconds).' })
  fps!: number;

  @Field({ nullable: true })
  error?: string;

  @Field(() => Int)
  in!: number;

  @Field(() => Int)
  out!: number;

  @Field(() => [CountingClassCount])
  byClass!: CountingClassCount[];

  @Field(() => GraphQLISODateTime, {
    nullable: true,
    description: 'When a count last changed in this run.'
  })
  updatedAt?: Date;
}

@ObjectType()
export class CountingCamera {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field()
  sourceUrl!: string;

  @Field()
  enabled!: boolean;

  @Field(() => Int)
  fps!: number;

  @Field(() => Float)
  confThreshold!: number;

  @Field(() => [Int], { description: 'Model class ids counted (countingClasses); empty = all.' })
  classes!: number[];

  @Field(() => Int)
  width!: number;

  @Field(() => Int)
  height!: number;

  @Field()
  loop!: boolean;

  @Field({
    nullable: true,
    description: 'The mobile warehouse (user id) it belongs to; null = Operation.'
  })
  warehouseId?: string;

  @Field(() => GraphQLISODateTime)
  countsResetAt!: Date;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  // Resolved: region, runtime.
  @Field(() => CountingRegion, { nullable: true })
  region?: CountingRegion;

  @Field(() => CountingRuntime)
  runtime?: CountingRuntime;
}

@ObjectType()
export class CountingHistoryBucket {
  @Field(() => GraphQLISODateTime, {
    description: 'The hour or the day (Phnom Penh) the counts belong to.'
  })
  periodStart!: Date;

  @Field(() => Int)
  in!: number;

  @Field(() => Int)
  out!: number;

  @Field(() => [CountingClassCount])
  byClass!: CountingClassCount[];
}

@ObjectType()
export class CountingClass {
  @Field(() => Int)
  id!: number;

  @Field()
  label!: string;
}

@ObjectType({ description: 'The model the cameras count with.' })
export class CountingModelInfo {
  @Field()
  loaded!: boolean;

  @Field({ nullable: true })
  error?: string;

  @Field()
  provider!: string;

  @Field(() => [CountingClass])
  classes!: CountingClass[];
}
