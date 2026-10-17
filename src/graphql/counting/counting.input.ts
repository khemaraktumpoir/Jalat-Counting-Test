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
