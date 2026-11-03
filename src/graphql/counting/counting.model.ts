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

  @Field(() => String, {
    nullable: true,
    description: 'Counts from this time each day ("HH:mm"); null with endTime = all day.'
  })
  startTime!: string | null;

  @Field(() => String, { nullable: true, description: 'Stops at this time each day ("HH:mm").' })
  endTime!: string | null;

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

  @Field(() => String, {
    nullable: true,
    description: "This camera's detector (demo:orange); null = the service's model."
  })
  model!: string | null;

  @Field({
    nullable: true,
    description: 'The first of warehouseIds (clients from before); null = Operation.'
  })
  warehouseId?: string;

  @Field(() => [String], {
    description: 'The mobile warehouses (user ids) it belongs to; empty = Operation (the hub).'
  })
  warehouseIds!: string[];

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

  @Field({
    description:
      'Cameras can be set to run on Ultralytics Platform (camera model "ultralytics"): ULTRALYTICS_ENDPOINT_URL and ULTRALYTICS_API_KEY are set.'
  })
  platform!: boolean;
}

@ObjectType({ description: 'The result of addManualCount, and the counter since its last reset.' })
export class ManualCountResult {
  @Field({ description: 'This scan or tap changed the count.' })
  counted!: boolean;

  @Field({ description: 'The code was already counted since the last reset (not counted again).' })
  duplicate!: boolean;

  @Field(() => String, { nullable: true })
  code?: string;

  @Field(() => Int, { description: 'Counted since the last reset (scanned + tapped).' })
  total!: number;

  @Field(() => Int)
  scanned!: number;

  @Field(() => Int)
  tapped!: number;
}

@ObjectType({ description: 'A QR code counted on a manual counter.' })
export class ManualScan {
  @Field()
  code!: string;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}

@ObjectType({ description: "A source's counts in the overview's time range." })
export class CountingSourceTotal {
  @Field(() => ID)
  cameraId!: string;

  @Field(() => Int)
  in!: number;

  @Field(() => Int)
  out!: number;

  @Field(() => [CountingClassCount])
  byClass!: CountingClassCount[];
}

@ObjectType({
  description: 'An hour or a day of the overview: the cameras and counting by scanning.'
})
export class CountingOverviewBucket {
  @Field(() => GraphQLISODateTime)
  periodStart!: Date;

  @Field(() => Int, { description: 'Parcels in, counted by the cameras.' })
  cameraIn!: number;

  @Field(() => Int, { description: 'Parcels out, counted by the cameras.' })
  cameraOut!: number;

  @Field(() => Int, { description: 'Parcels counted by scanning (manual counters).' })
  manualIn!: number;
}

@ObjectType({
  description: 'Every visible source in a time range (e.g. today), and per hour or day.'
})
export class CountingOverview {
  @Field(() => [CountingSourceTotal])
  sources!: CountingSourceTotal[];

  @Field(() => [CountingOverviewBucket])
  buckets!: CountingOverviewBucket[];
}

@ObjectType({ description: 'How many objects of one label a photo (or a batch) has.' })
export class PhotoClassCount {
  @Field()
  label!: string;

  @Field(() => Int)
  count!: number;
}

@ObjectType({
  description: 'One object found in a photo: its box as fractions (0–1) of the photo.'
})
export class PhotoBox {
  @Field(() => Float)
  x!: number;

  @Field(() => Float)
  y!: number;

  @Field(() => Float)
  w!: number;

  @Field(() => Float)
  h!: number;

  @Field()
  label!: string;

  @Field(() => Float)
  score!: number;
}

@ObjectType({ description: 'What counts the objects in photos.' })
export class PhotoModelInfo {
  @Field({
    description:
      "parcels: the parcel model (every object found is a parcel); cameras: the cameras' model, by its labels"
  })
  kind!: string;

  @Field({ description: 'The model file, e.g. parcel-world-m.onnx' })
  name!: string;

  @Field(() => Float, { description: 'The confidence used when none is sent' })
  conf!: number;
}

@ObjectType({ description: 'A box the model gave in a photo that was not counted, and why.' })
export class PhotoSkippedBox extends PhotoBox {
  @Field({
    description:
      'duplicate: the same parcel boxed twice; floor: a box over most of the photo; weak: a weak guess lying on a surer parcel'
  })
  reason!: string;
}

@ObjectType({ description: 'An earlier counted photo, as a copy points to it.' })
export class PhotoRecordRef {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field(() => ID)
  batchId!: string;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}

@ObjectType({ description: 'The objects counted in one photo.' })
export class PhotoCount {
  @Field({ description: 'The file name.' })
  name!: string;

  @Field(() => Int, { description: 'The size it was counted at (0 when it could not be read).' })
  width!: number;

  @Field(() => Int)
  height!: number;

  @Field(() => Int)
  count!: number;

  @Field(() => [PhotoClassCount])
  byClass!: PhotoClassCount[];

  @Field(() => [PhotoBox])
  boxes!: PhotoBox[];

  @Field(() => [PhotoSkippedBox], {
    description: 'Boxes the model gave but that were not counted (duplicates, the floor), and why.'
  })
  skipped!: PhotoSkippedBox[];

  @Field(() => String, {
    nullable: true,
    description:
      "The photo's fingerprint (64 hex): photos within 40 bits of each other show the same scene (a copy)."
  })
  fingerprint!: string | null;

  @Field(() => [[Float]], {
    nullable: true,
    description:
      "Each box's look (512 numbers, same order as boxes), when the parcel look-alike model is there: the app compares them across a batch to suggest a parcel already in another photo."
  })
  embeddings!: number[][] | null;

  @Field(() => String, {
    nullable: true,
    description: 'In a folder count: the earlier photo this one is a copy of (not counted again).'
  })
  copyOf!: string | null;

  @Field(() => ID, {
    nullable: true,
    description: 'The saved record of this photo (counted in a batch).'
  })
  recordId!: string | null;

  @Field(() => PhotoRecordRef, {
    nullable: true,
    description:
      'The earlier counted photo this one is a copy of, from any batch of the last PHOTO_DUP_DAYS days.'
  })
  copyOfRecord!: PhotoRecordRef | null;

  @Field(() => String, { nullable: true, description: 'Why the photo could not be counted.' })
  error!: string | null;
}

@ObjectType({ description: 'The photos of a folder on the counting service, counted.' })
export class PhotoFolderCount {
  @Field()
  folder!: string;

  @Field(() => [PhotoCount])
  photos!: PhotoCount[];

  @Field(() => Int, { description: 'Objects in all the photos counted.' })
  total!: number;

  @Field(() => Int, { description: 'Photos counted.' })
  counted!: number;

  @Field(() => Int, { description: 'Photos that could not be read.' })
  failed!: number;

  @Field(() => [PhotoClassCount])
  byClass!: PhotoClassCount[];

  @Field({
    description:
      'The folder has more photos than the limit: only the first ones (by name) were counted.'
  })
  more!: boolean;

  @Field(() => Int, {
    description: 'Photos that are copies of an earlier one, left out of the total.'
  })
  copies!: number;
}

@ObjectType({
  description: 'One run of Count photos (or a folder count): its photos counted together.'
})
export class PhotoBatch {
  @Field(() => ID)
  batchId!: string;

  @Field(() => GraphQLISODateTime)
  startedAt!: Date;

  @Field(() => Int)
  photos!: number;

  @Field(() => Int, { description: 'Objects counted, copies left out.' })
  parcels!: number;

  @Field(() => Int, { description: 'Photos that are copies of an earlier one.' })
  copies!: number;

  @Field(() => Int, {
    description:
      'Parcels marked as already shown in an earlier photo of the batch (left out of parcels).'
  })
  repeats!: number;

  @Field(() => Int, { description: 'Parcels added by hand (in parcels).' })
  added!: number;

  @Field(() => Int, { description: "The model's boxes taken off by hand (left out of parcels)." })
  removed!: number;

  @Field(() => String, { nullable: true, description: "The batch's name (a driver, a pickup…)." })
  note!: string | null;

  @Field({ description: 'Who counted (the account id).' })
  ownerId!: string;
}

@ObjectType({
  description: 'A counted photo, kept for copies across batches and the records page.'
})
export class PhotoRecord {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  batchId!: string;

  @Field(() => Int, { description: 'Its place in the batch, as picked (0 first).' })
  seq!: number;

  @Field()
  name!: string;

  @Field(() => Int)
  count!: number;

  @Field(() => [PhotoClassCount])
  byClass!: PhotoClassCount[];

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => PhotoRecordRef, {
    nullable: true,
    description: 'The earlier photo it is a copy of; null for an original.'
  })
  copyOf!: PhotoRecordRef | null;

  @Field(() => Int, {
    description:
      'Parcels in it that an earlier photo of the batch already shows (marked by hand): not counted again.'
  })
  repeats!: number;

  @Field(() => PhotoRecordRef, {
    nullable: true,
    description: 'The earlier photo of the batch that shows those parcels.'
  })
  repeatsOf!: PhotoRecordRef | null;

  @Field(() => Int, { description: 'Parcels the model missed, added by hand.' })
  added!: number;

  @Field(() => Int, { description: "The model's boxes taken off by hand (not parcels)." })
  removed!: number;
}

@ObjectType({
  description:
    'A test video ready to use as a camera (test-videos/cameras.json): its settings, its line or area, and what one play counts.'
})
export class CountingTestVideo {
  @Field({ description: 'test-videos/x.mp4, as a camera source.' })
  sourceUrl!: string;

  @Field({ description: 'The camera name it suggests.' })
  name!: string;

  @Field({ description: 'What the video shows.' })
  about!: string;

  @Field(() => Int)
  fps!: number;

  @Field(() => Float)
  confThreshold!: number;

  @Field(() => Int)
  width!: number;

  @Field(() => Int)
  height!: number;

  @Field()
  loop!: boolean;

  @Field(() => String, {
    nullable: true,
    description: 'Its detector (demo:orange); null = the service model.'
  })
  model!: string | null;

  @Field(() => E.RegionTypeEnum, {
    description: 'A line or an area: set on the camera when it is created.'
  })
  regionType!: E.RegionTypeEnum;

  @Field(() => Int, { description: 'Parcels IN in one play of the video.' })
  expectedIn!: number;

  @Field(() => Int, { description: 'Parcels OUT in one play of the video.' })
  expectedOut!: number;
}
