import { ArgsType, Field, Float, ID, InputType, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator';

import { E } from '@common';

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

  @Field({
    nullable: true,
    description: 'Operation / admin only: the mobile warehouse it belongs to.'
  })
  @IsOptional()
  @IsString()
  warehouseId?: string;
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

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  warehouseId?: string;
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
      'A folder on the counting service, inside PHOTO_ROOTS (default photos, samples): e.g. "photos/batch-21-10"'
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
