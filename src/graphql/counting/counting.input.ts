import { ArgsType, Field, Float, ID, InputType, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator';

import { E } from '@common';
import { DEMO_MODEL, PLATFORM_MODEL } from '@lib/counting';

import { SCHEDULE_TIME } from './counting.rules';

/** What a camera may use instead of the service's model (null: the service's). */
const CAMERA_MODELS = [DEMO_MODEL, PLATFORM_MODEL];
const MODEL_DESCRIPTION =
  "demo:orange (the colour detector, for the synthetic test videos); ultralytics (the model on Ultralytics Platform, ULTRALYTICS_ENDPOINT_URL: countingModel.platform says whether it is set up); null = the service's model.";

@InputType()
export class CreateCountingCameraInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @Field({ description: 'rtsp://…, http(s)://… or a video file path on the server.' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  sourceUrl!: string;

  @Field({ nullable: true, description: 'Start it now, and with the service.' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @Field(() => String, {
    nullable: true,
    description:
      'Counts from this time each day ("HH:mm", Asia/Phnom_Penh); null with endTime = all day.'
  })
  @IsOptional()
  @Matches(SCHEDULE_TIME, { message: 'startTime is HH:mm (00:00-23:59).' })
  startTime?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Stops at this time each day ("HH:mm"); before startTime = over midnight.'
  })
  @IsOptional()
  @Matches(SCHEDULE_TIME, { message: 'endTime is HH:mm (00:00-23:59).' })
  endTime?: string | null;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  fps?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0.05)
  @Max(0.99)
  confThreshold?: number;

  @Field(() => [Int], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  classes?: number[];

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(160)
  @Max(3840)
  width?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(120)
  @Max(2160)
  height?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  loop?: boolean;

  @Field(() => String, { nullable: true, description: MODEL_DESCRIPTION })
  @IsOptional()
  @IsIn(CAMERA_MODELS)
  model?: string | null;

  @Field({
    nullable: true,
    description: 'One mobile warehouse it belongs to (clients from before warehouseIds).'
  })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @Field(() => [String], {
    nullable: true,
    description:
      'The mobile warehouses it belongs to: Operation picks any; a Counter registered to several picks among them.'
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  warehouseIds?: string[];
}

@InputType()
export class UpdateCountingCameraInput {
  @Field(() => ID)
  @IsUUID()
  id!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  sourceUrl?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @Field(() => String, {
    nullable: true,
    description:
      'Counts from this time each day ("HH:mm", Asia/Phnom_Penh); null with endTime = all day.'
  })
  @IsOptional()
  @Matches(SCHEDULE_TIME, { message: 'startTime is HH:mm (00:00-23:59).' })
  startTime?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Stops at this time each day ("HH:mm"); before startTime = over midnight.'
  })
  @IsOptional()
  @Matches(SCHEDULE_TIME, { message: 'endTime is HH:mm (00:00-23:59).' })
  endTime?: string | null;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  fps?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0.05)
  @Max(0.99)
  confThreshold?: number;

  @Field(() => [Int], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  classes?: number[];

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(160)
  @Max(3840)
  width?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(120)
  @Max(2160)
  height?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  loop?: boolean;

  @Field(() => String, { nullable: true, description: MODEL_DESCRIPTION })
  @IsOptional()
  @IsIn(CAMERA_MODELS)
  model?: string | null;

  @Field({ nullable: true, description: 'One mobile warehouse: replaces all of them.' })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @Field(() => [String], {
    nullable: true,
    description:
      'The mobile warehouses it belongs to (Operation: any, [] = the hub; a warehouse or Counter: among its own).'
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  warehouseIds?: string[];
}

@InputType()
export class CountingPointInput {
  @Field(() => Float)
  @IsNumber()
  x!: number;

  @Field(() => Float)
  @IsNumber()
  y!: number;
}

@InputType()
export class SaveCountingRegionInput {
  @Field(() => ID)
  @IsUUID()
  cameraId!: string;

  @Field(() => E.RegionTypeEnum)
  @IsEnum(E.RegionTypeEnum)
  type!: E.RegionTypeEnum;

  @Field(() => [CountingPointInput], {
    description: 'Camera pixels. LINE: exactly 2; POLYGON: 3 or more.'
  })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CountingPointInput)
  points!: CountingPointInput[];
}

@ArgsType()
export class CountingHistoryArgs {
  @Field(() => ID)
  @IsUUID()
  cameraId!: string;

  @Field()
  @IsDateString()
  from!: string;

  @Field()
  @IsDateString()
  to!: string;

  @Field(() => E.CountBucketEnum, { defaultValue: E.CountBucketEnum.HOUR })
  @IsEnum(E.CountBucketEnum)
  bucket!: E.CountBucketEnum;
}

@InputType({ description: 'A parcel counted by hand on a manual counter ("manual:").' })
export class AddManualCountInput {
  @Field(() => ID)
  @IsUUID()
  cameraId!: string;

  @Field({
    nullable: true,
    description:
      'The QR code scanned: counted once since the last reset. None: a tap ("no sticker").'
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  code?: string;

  @Field(() => Int, {
    nullable: true,
    defaultValue: 1,
    description: '1 counts it; -1 takes it back (that code, or one tap).'
  })
  @IsOptional()
  @IsInt()
  @Min(-1)
  @Max(1)
  delta?: number;
}

@ArgsType()
export class CountingOverviewArgs {
  @Field()
  @IsDateString()
  from!: string;

  @Field()
  @IsDateString()
  to!: string;

  @Field(() => E.CountBucketEnum, { defaultValue: E.CountBucketEnum.HOUR })
  @IsEnum(E.CountBucketEnum)
  bucket!: E.CountBucketEnum;
}

@ArgsType()
export class PhotoFolderArgs {
  @Field({
    description:
      'A folder on the counting service, inside PHOTO_ROOTS (default photos, test-videos): e.g. "photos/batch-21-10"'
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  path!: string;

  @Field(() => Float, {
    nullable: true,
    description: 'Minimum score (0–1); DEFAULT_CONF when left out.'
  })
  @IsOptional()
  @IsNumber()
  @Min(0.05)
  @Max(0.95)
  conf?: number;

  @Field(() => [Int], { nullable: true, description: 'Class ids to count; all when left out.' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  classes?: number[];

  @Field(() => Int, {
    defaultValue: 200,
    description: 'Photos to count at most (by name), up to 500.'
  })
  @IsInt()
  @Min(1)
  @Max(500)
  limit!: number;
}

@ArgsType()
export class PhotoBatchesArgs {
  @Field({ description: 'From (ISO date-time)' })
  @IsDateString()
  from!: string;

  @Field({ description: 'To (ISO date-time)' })
  @IsDateString()
  to!: string;

  @Field({ nullable: true, description: "Words in the batch's name or a photo's name." })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

@InputType({ description: 'A name for a batch of counted photos (a driver, a pickup, a truck…).' })
export class NamePhotoBatchInput {
  @Field(() => ID)
  @IsUUID()
  batchId!: string;

  @Field({ nullable: true, description: 'Empty or left out: no name.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  note?: string;
}

@InputType({
  description:
    'Parcels in a counted photo that an earlier photo of the same batch already shows (one parcel photographed twice).'
})
export class MarkPhotoRepeatsInput {
  @Field(() => ID, { description: 'The photo (PhotoRecord.id).' })
  @IsUUID()
  recordId!: string;

  @Field(() => Int, { description: 'How many of its parcels are repeats; 0 clears the mark.' })
  @IsInt()
  @Min(0)
  repeats!: number;

  @Field(() => ID, {
    nullable: true,
    description: 'The earlier photo of the batch that shows them (needed when repeats > 0).'
  })
  @IsOptional()
  @IsUUID()
  ofRecordId?: string;
}

@InputType({
  description:
    'A counted photo fixed by hand: parcels the model missed (added) and boxes that are not parcels (removed).'
})
export class CorrectPhotoCountInput {
  @Field(() => ID, { description: 'The photo (PhotoRecord.id).' })
  @IsUUID()
  recordId!: string;

  @Field(() => Int, { description: 'Parcels added by hand.' })
  @IsInt()
  @Min(0)
  @Max(500)
  added!: number;

  @Field(() => Int, { description: "The model's boxes taken off (not parcels)." })
  @IsInt()
  @Min(0)
  removed!: number;
}

@ArgsType()
export class PhotoRecordsArgs {
  @Field(() => ID, { nullable: true, description: "One batch's photos, in the order picked." })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @Field({ nullable: true, description: 'Only the copies (between from and to).' })
  @IsOptional()
  @IsBoolean()
  copiesOnly?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsDateString()
  from?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsDateString()
  to?: string;

  @Field(() => Int, { defaultValue: 200 })
  @IsInt()
  @Min(1)
  @Max(1000)
  limit!: number;
}
